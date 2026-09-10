#include "features/wallpaper/wallpaper.h"

#include <HTTPClient.h>
#include <LittleFS.h>
#include <SD.h>
#include <SPI.h>
#include <WiFi.h>
#include <driver/gpio.h>
#include <atomic>
#include <esp_heap_caps.h>
#include <jpeg_decoder.h>
#include <mbedtls/sha256.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

namespace Wallpaper {
namespace {

constexpr char kPackagePath[] = "/wallpaper.azw";
constexpr char kTemporaryPath[] = "/wallpaper.tmp";
constexpr char kHashPath[] = "/wallpaper.sha";
constexpr size_t kHeaderSize = 20;
constexpr size_t kFlashMaxPackageSize = 3200000;
constexpr size_t kSdMaxPackageSize = 24 * 1024 * 1024;
constexpr size_t kMaxFrameSize = 600000;
constexpr uint16_t kWidth = 480;
constexpr uint16_t kHeight = 480;
constexpr size_t kPixelBufferSize = kWidth * kHeight * sizeof(lv_color_t);
constexpr int kSdSck = 45;
constexpr int kSdMiso = 46;
constexpr int kSdMosi = 42;
constexpr int kSdCs = 47;
constexpr uint32_t kSdFrequency = 20000000;
constexpr uint32_t kSdProbingFrequency = 400000;

SemaphoreHandle_t storage_mutex = nullptr;
fs::FS *storage = nullptr;
lv_obj_t *view = nullptr;
lv_obj_t *image = nullptr;
lv_obj_t *empty_label = nullptr;
lv_img_dsc_t descriptor{};
uint8_t *pixels = nullptr;
uint8_t *compressed = nullptr;
String installed_hash;
std::atomic<uint32_t> asset_revision{0};
uint32_t shown_asset_revision = UINT32_MAX;
uint32_t next_frame_due = 0;
uint32_t next_frame_offset = kHeaderSize;
uint16_t frame_count = 0;
uint16_t frame_delay_ms = 0;
uint16_t frame_index = 0;
bool is_active = false;
bool filesystem_ready = false;
bool using_sd = false;
TaskHandle_t storage_task_handle = nullptr;

size_t maxPackageSize() {
  return using_sd ? kSdMaxPackageSize : kFlashMaxPackageSize;
}

uint64_t storageTotalBytes() {
  return using_sd ? SD.totalBytes() : LittleFS.totalBytes();
}

uint64_t storageUsedBytes() {
  return using_sd ? SD.usedBytes() : LittleFS.usedBytes();
}

uint16_t readU16(const uint8_t *value) {
  return static_cast<uint16_t>(value[0]) |
         (static_cast<uint16_t>(value[1]) << 8);
}

uint32_t readU32(const uint8_t *value) {
  return static_cast<uint32_t>(value[0]) |
         (static_cast<uint32_t>(value[1]) << 8) |
         (static_cast<uint32_t>(value[2]) << 16) |
         (static_cast<uint32_t>(value[3]) << 24);
}

bool validHash(const String &hash) {
  if (hash.length() != 64) return false;
  for (size_t index = 0; index < hash.length(); ++index) {
    const char value = hash[index];
    if (!((value >= '0' && value <= '9') ||
          (value >= 'a' && value <= 'f'))) return false;
  }
  return true;
}

bool readHeader(File &file, uint16_t &frames, uint16_t &delay) {
  uint8_t header[kHeaderSize]{};
  if (!file || file.size() < kHeaderSize + 8 ||
      file.read(header, sizeof(header)) != sizeof(header) ||
      memcmp(header, "AZW1", 4) || readU16(header + 4) != kWidth ||
      readU16(header + 6) != kHeight) return false;
  frames = readU16(header + 8);
  delay = readU16(header + 10);
  const uint32_t payload_size = readU32(header + 12);
  return frames >= 1 && frames <= 120 &&
         ((frames == 1 && delay == 0) ||
          (frames > 1 && delay >= 100 && delay <= 2000)) &&
         payload_size == file.size() - kHeaderSize;
}

bool validatePackage(fs::FS &filesystem, const char *path) {
  File file = filesystem.open(path, "r");
  uint16_t frames = 0;
  uint16_t delay = 0;
  if (!readHeader(file, frames, delay)) {
    file.close();
    return false;
  }
  for (uint16_t index = 0; index < frames; ++index) {
    uint8_t size_bytes[4]{};
    if (file.read(size_bytes, sizeof(size_bytes)) != sizeof(size_bytes)) {
      file.close();
      return false;
    }
    const uint32_t size = readU32(size_bytes);
    if (size < 128 || size > kMaxFrameSize ||
        static_cast<size_t>(file.position()) + size > file.size()) {
      file.close();
      return false;
    }
    const uint32_t start = file.position();
    uint8_t marker[2]{};
    if (file.read(marker, 2) != 2 || marker[0] != 0xff || marker[1] != 0xd8 ||
        !file.seek(start + size - 2) || file.read(marker, 2) != 2 ||
        marker[0] != 0xff || marker[1] != 0xd9) {
      file.close();
      return false;
    }
  }
  const bool exact = static_cast<size_t>(file.position()) == file.size();
  file.close();
  return exact;
}

bool decodeFrame(File &file) {
  uint8_t size_bytes[4]{};
  if (file.read(size_bytes, sizeof(size_bytes)) != sizeof(size_bytes)) return false;
  const uint32_t size = readU32(size_bytes);
  if (size < 128 || size > kMaxFrameSize ||
      static_cast<size_t>(file.position()) + size > file.size() ||
      file.read(compressed, size) != size) return false;
  esp_jpeg_image_cfg_t config{};
  config.indata = compressed;
  config.indata_size = size;
  config.outbuf = pixels;
  config.outbuf_size = kPixelBufferSize;
  config.out_format = JPEG_IMAGE_FORMAT_RGB565;
  config.out_scale = JPEG_IMAGE_SCALE_0;
  config.flags.swap_color_bytes = 0;
  esp_jpeg_image_output_t output{};
  if (esp_jpeg_decode(&config, &output) != ESP_OK ||
      output.width != kWidth || output.height != kHeight ||
      output.output_len != kPixelBufferSize) return false;
  next_frame_offset = file.position();
  lv_img_cache_invalidate_src(&descriptor);
  lv_img_set_src(image, &descriptor);
  lv_obj_invalidate(image);
  return true;
}

bool loadFirstFrame() {
  if (!filesystem_ready || !pixels || !compressed || currentHash().isEmpty()) return false;
  xSemaphoreTake(storage_mutex, portMAX_DELAY);
  File file = storage->open(kPackagePath, "r");
  uint16_t frames = 0;
  uint16_t delay = 0;
  bool loaded = readHeader(file, frames, delay) && decodeFrame(file);
  file.close();
  xSemaphoreGive(storage_mutex);
  if (!loaded) return false;
  frame_count = frames;
  frame_delay_ms = delay;
  frame_index = 0;
  next_frame_due = millis() + frame_delay_ms;
  return true;
}

void updateEmptyState(bool loaded) {
  if (!empty_label || !image) return;
  if (loaded) {
    lv_obj_add_flag(empty_label, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(image, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_add_flag(image, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(empty_label, LV_OBJ_FLAG_HIDDEN);
  }
}

String hexDigest(const uint8_t digest[32]) {
  static const char digits[] = "0123456789abcdef";
  char value[65]{};
  for (size_t index = 0; index < 32; ++index) {
    value[index * 2] = digits[digest[index] >> 4];
    value[index * 2 + 1] = digits[digest[index] & 0x0f];
  }
  return String(value);
}

bool download(const String &host, uint16_t port, const String &expected_hash,
              size_t expected_size) {
  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(2500);
  http.setTimeout(15000);
  if (!http.begin(client, "http://" + host + ":" + String(port) +
                              "/v1/wallpaper")) return false;
  const int code = http.GET();
  if (code != 200 || (http.getSize() >= 0 &&
                      static_cast<size_t>(http.getSize()) != expected_size)) {
    http.end();
    return false;
  }
  File file = storage->open(kTemporaryPath, "w");
  if (!file) {
    http.end();
    return false;
  }
  mbedtls_sha256_context sha{};
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  NetworkClient *stream = http.getStreamPtr();
  uint8_t buffer[4096];
  size_t received = 0;
  uint32_t last_data = millis();
  bool ok = true;
  while (received < expected_size) {
    const size_t available = stream->available();
    if (available == 0) {
      if (!http.connected() || millis() - last_data > 15000) {
        ok = false;
        break;
      }
      delay(2);
      continue;
    }
    const size_t wanted = min(sizeof(buffer),
                              min(available, expected_size - received));
    const int count = stream->readBytes(buffer, wanted);
    if (count <= 0 || file.write(buffer, count) != static_cast<size_t>(count)) {
      ok = false;
      break;
    }
    mbedtls_sha256_update(&sha, buffer, count);
    received += count;
    last_data = millis();
  }
  uint8_t digest[32]{};
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  file.close();
  http.end();
  return ok && received == expected_size &&
         hexDigest(digest) == expected_hash;
}

bool copyFile(fs::FS &source_fs, fs::FS &target_fs, const char *source_path,
              const char *target_path) {
  File source = source_fs.open(source_path, "r");
  File target = target_fs.open(target_path, "w");
  if (!source || !target) {
    source.close();
    target.close();
    target_fs.remove(target_path);
    return false;
  }

  uint8_t buffer[4096];
  bool ok = true;
  while (source.available() > 0 && ok) {
    const int count = source.read(buffer, sizeof(buffer));
    if (count <= 0 || target.write(buffer, count) != count) ok = false;
  }
  source.close();
  target.close();
  if (!ok) target_fs.remove(target_path);
  return ok;
}

void prepareSdGpios() {
  // VIEWE's official BSP releases GPIO holds and clocks the bus before SDSPI
  // claims GPIO47, which the LCD initializer has just used as its data line.
  gpio_hold_dis(static_cast<gpio_num_t>(kSdCs));
  gpio_hold_dis(static_cast<gpio_num_t>(kSdMosi));
  gpio_hold_dis(static_cast<gpio_num_t>(kSdMiso));
  gpio_hold_dis(static_cast<gpio_num_t>(kSdSck));
  gpio_reset_pin(static_cast<gpio_num_t>(kSdCs));
  gpio_reset_pin(static_cast<gpio_num_t>(kSdMosi));
  gpio_reset_pin(static_cast<gpio_num_t>(kSdMiso));
  gpio_reset_pin(static_cast<gpio_num_t>(kSdSck));

  const gpio_config_t output_config = {
      .pin_bit_mask = (1ULL << kSdCs) | (1ULL << kSdMosi) |
                      (1ULL << kSdSck),
      .mode = GPIO_MODE_OUTPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  gpio_config(&output_config);

  const gpio_config_t input_config = {
      .pin_bit_mask = 1ULL << kSdMiso,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  gpio_config(&input_config);

  gpio_set_level(static_cast<gpio_num_t>(kSdCs), 1);
  gpio_set_level(static_cast<gpio_num_t>(kSdSck), 0);
  gpio_set_level(static_cast<gpio_num_t>(kSdMosi), 1);
  for (int index = 0; index < 16; ++index) {
    gpio_set_level(static_cast<gpio_num_t>(kSdSck), 0);
    delayMicroseconds(10);
    gpio_set_level(static_cast<gpio_num_t>(kSdSck), 1);
    delayMicroseconds(10);
  }
  gpio_set_level(static_cast<gpio_num_t>(kSdSck), 0);
  delay(20);
}

bool mountSdAtFrequency(uint32_t frequency) {
  prepareSdGpios();
  SPI.begin(kSdSck, kSdMiso, kSdMosi, kSdCs);
  pinMode(kSdCs, OUTPUT);
  digitalWrite(kSdCs, HIGH);
  Serial.printf("TF mount attempt: %lu Hz\n",
                static_cast<unsigned long>(frequency));
  if (!SD.begin(kSdCs, SPI, frequency, "/sd", 5, false) ||
      SD.cardType() == CARD_NONE) {
    SD.end();
    SPI.end();
    return false;
  }
  return true;
}

bool adoptSdStorage() {
  // Keep the wallpaper that was installed before the card was inserted.
  String hash;
  File hash_file = LittleFS.open(kHashPath, "r");
  if (hash_file) {
    hash = hash_file.readString();
    hash_file.close();
    hash.trim();
  }

  if (validHash(hash)) {
    const bool copied = copyFile(LittleFS, SD, kPackagePath, kTemporaryPath) &&
                        validatePackage(SD, kTemporaryPath);
    if (copied) {
      SD.remove(kPackagePath);
      if (!SD.rename(kTemporaryPath, kPackagePath)) {
        SD.remove(kTemporaryPath);
        hash = "";
      } else {
        File hash_file = SD.open(kHashPath, "w");
        if (hash_file) {
          hash_file.print(hash);
          hash_file.close();
        } else {
          hash = "";
        }
      }
    } else {
      hash = "";
    }
  }

  xSemaphoreTake(storage_mutex, portMAX_DELAY);
  storage = &SD;
  using_sd = true;
  installed_hash = hash;
  asset_revision.fetch_add(1);
  xSemaphoreGive(storage_mutex);
  Serial.printf("Wallpaper storage: TF card, size=%llu MB\n",
                static_cast<unsigned long long>(SD.cardSize() / 1024 / 1024));
  return true;
}

bool tryMountSd() {
  if (using_sd) return true;
  if (mountSdAtFrequency(kSdFrequency)) return adoptSdStorage();
  if (mountSdAtFrequency(kSdProbingFrequency)) return adoptSdStorage();
  return false;
}

void storagePollTask(void *) {
  for (;;) {
    delay(2000);
    if (tryMountSd()) {
      storage_task_handle = nullptr;
      vTaskDelete(nullptr);
    }
  }
}

}  // namespace

bool begin() {
  storage_mutex = xSemaphoreCreateMutex();
  if (!storage_mutex) {
    Serial.println("Wallpaper storage unavailable");
    return false;
  }

  if (!tryMountSd()) {
    if (!LittleFS.begin(true)) {
      Serial.println("Wallpaper storage unavailable");
      return false;
    }
    storage = &LittleFS;
    Serial.printf("Wallpaper storage: LittleFS, size=%u KB\n",
                  static_cast<unsigned>(LittleFS.totalBytes() / 1024));
    if (xTaskCreatePinnedToCore(storagePollTask, "tf-storage", 4096, nullptr,
                                1, &storage_task_handle, 0) != pdPASS) {
      storage_task_handle = nullptr;
      Serial.println("TF hot-plug monitor unavailable");
    }
  }
  filesystem_ready = true;
  File hash_file = storage->open(kHashPath, "r");
  installed_hash = hash_file ? hash_file.readString() : "";
  hash_file.close();
  installed_hash.trim();
  if (!validHash(installed_hash) ||
      !validatePackage(*storage, kPackagePath)) {
    installed_hash = "";
    storage->remove(kPackagePath);
    storage->remove(kHashPath);
  }
  return true;
}

void createView(lv_obj_t *parent, lv_event_cb_t exit_callback) {
  pixels = static_cast<uint8_t *>(heap_caps_malloc(
      kPixelBufferSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  compressed = static_cast<uint8_t *>(heap_caps_malloc(
      kMaxFrameSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  descriptor.header.always_zero = 0;
  descriptor.header.w = kWidth;
  descriptor.header.h = kHeight;
  descriptor.header.cf = LV_IMG_CF_TRUE_COLOR;
  descriptor.data_size = kPixelBufferSize;
  descriptor.data = pixels;

  view = lv_obj_create(parent);
  lv_obj_set_pos(view, 0, 0);
  lv_obj_set_size(view, kWidth, kHeight);
  lv_obj_set_style_pad_all(view, 0, 0);
  lv_obj_set_style_border_width(view, 0, 0);
  lv_obj_set_style_radius(view, 0, 0);
  lv_obj_set_style_bg_color(view, lv_color_hex(0x000000), 0);
  lv_obj_clear_flag(view, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_event_cb(view, exit_callback, LV_EVENT_CLICKED, nullptr);
  image = lv_img_create(view);
  lv_obj_set_pos(image, 0, 0);
  lv_obj_clear_flag(image, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  empty_label = lv_label_create(view);
  lv_label_set_text(empty_label, "NO WALLPAPER\n\nTAP TO RETURN");
  lv_obj_set_style_text_align(empty_label, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_style_text_color(empty_label, lv_color_hex(0x64748B), 0);
  lv_obj_center(empty_label);
  lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN);
}

void show() {
  if (!view) return;
  shown_asset_revision = asset_revision.load();
  updateEmptyState(loadFirstFrame());
  is_active = true;
  lv_obj_clear_flag(view, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(view);
  lv_obj_invalidate(view);
}

void hide() {
  if (!view || !is_active) return;
  is_active = false;
  lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN);
  lv_obj_invalidate(lv_scr_act());
}

bool active() {
  return is_active;
}

String currentHash() {
  if (!storage_mutex) return "";
  xSemaphoreTake(storage_mutex, portMAX_DELAY);
  const String value = installed_hash;
  xSemaphoreGive(storage_mutex);
  return value;
}

const char *storageKind() {
  if (!filesystem_ready) return "unavailable";
  return using_sd ? "tf" : "flash";
}

size_t packageLimit() {
  return maxPackageSize();
}

void refresh() {
  if (!is_active || !view) return;
  const uint32_t current_revision = asset_revision.load();
  if (shown_asset_revision != current_revision) {
    shown_asset_revision = current_revision;
    updateEmptyState(loadFirstFrame());
    return;
  }
  if (frame_count < 2 || frame_delay_ms == 0 ||
      static_cast<int32_t>(millis() - next_frame_due) < 0) return;
  xSemaphoreTake(storage_mutex, portMAX_DELAY);
  File file = storage->open(kPackagePath, "r");
  bool loaded = file && file.seek(next_frame_offset) && decodeFrame(file);
  file.close();
  xSemaphoreGive(storage_mutex);
  if (!loaded) {
    updateEmptyState(false);
    return;
  }
  frame_index = static_cast<uint16_t>((frame_index + 1) % frame_count);
  if (frame_index == 0) next_frame_offset = kHeaderSize;
  next_frame_due = millis() + frame_delay_ms;
}

bool sync(const String &host, uint16_t port, const String &sha256,
          size_t size) {
  if (!filesystem_ready || host.isEmpty()) return false;
  if (sha256.isEmpty() || size == 0) {
    if (installed_hash.isEmpty()) return true;
    xSemaphoreTake(storage_mutex, portMAX_DELAY);
    storage->remove(kPackagePath);
    storage->remove(kHashPath);
    installed_hash = "";
    asset_revision.fetch_add(1);
    xSemaphoreGive(storage_mutex);
    return true;
  }
  if (!validHash(sha256) || size < kHeaderSize + 8 ||
      size > maxPackageSize()) {
    Serial.printf("WALLPAPER_SYNC,rejected=package,size=%u,limit=%u,storage=%s\n",
                  static_cast<unsigned>(size),
                  static_cast<unsigned>(maxPackageSize()), storageKind());
    return false;
  }
  if (installed_hash == sha256) return true;
  storage->remove(kTemporaryPath);
  // Preserve the old package when there is room for an atomic replacement;
  // otherwise release it before downloading the new version.
  if (storageTotalBytes() - storageUsedBytes() < size + 4096) {
    xSemaphoreTake(storage_mutex, portMAX_DELAY);
    storage->remove(kPackagePath);
    storage->remove(kHashPath);
    installed_hash = "";
    asset_revision.fetch_add(1);
    xSemaphoreGive(storage_mutex);
  }
  if (storageTotalBytes() - storageUsedBytes() < size + 4096) {
    Serial.printf("WALLPAPER_SYNC,rejected=space,size=%u,free=%llu,storage=%s\n",
                  static_cast<unsigned>(size),
                  static_cast<unsigned long long>(storageTotalBytes() - storageUsedBytes()),
                  storageKind());
    return false;
  }
  if (!download(host, port, sha256, size) ||
      !validatePackage(*storage, kTemporaryPath)) {
    storage->remove(kTemporaryPath);
    return false;
  }
  xSemaphoreTake(storage_mutex, portMAX_DELAY);
  storage->remove(kPackagePath);
  const bool renamed = storage->rename(kTemporaryPath, kPackagePath);
  bool committed = false;
  if (renamed) {
    File hash_file = storage->open(kHashPath, "w");
    if (hash_file) {
      hash_file.print(sha256);
      hash_file.close();
      installed_hash = sha256;
      asset_revision.fetch_add(1);
      committed = true;
    }
  }
  xSemaphoreGive(storage_mutex);
  Serial.printf("WALLPAPER_SYNC,ok=%d,size=%u,storage=%s\n",
                committed ? 1 : 0, static_cast<unsigned>(size),
                using_sd ? "tf" : "flash");
  return committed;
}

}  // namespace Wallpaper
