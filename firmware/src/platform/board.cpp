#include "platform/board.h"

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp32-hal-rmt.h>
#include <esp_display_panel.hpp>
#include <esp_lcd_panel_rgb.h>
#include <new>

namespace {

#ifndef AZORIA_RGB_CLOCK_HZ
#define AZORIA_RGB_CLOCK_HZ 16000000
#endif

#ifndef AZORIA_RGB_BOUNCE_BUFFER_SIZE
#define AZORIA_RGB_BOUNCE_BUFFER_SIZE (480 * 60)
#endif

esp_panel::board::Board *hardware = nullptr;
esp_panel::drivers::LCD *lcd = nullptr;
esp_panel::drivers::Backlight *backlight = nullptr;
void *current_frame_buffer = nullptr;
uint16_t rotation_degrees = 0;
bool current_frame_buffer_is_rotated = false;
esp_panel::drivers::BusI2C *touch_bus = nullptr;
esp_lcd_panel_io_handle_t touch_io = nullptr;

constexpr uint8_t kTouchDiagnosticRegisters[] = {
    0x00,
    0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA8,
};
uint8_t touch_preinit_values[sizeof(kTouchDiagnosticRegisters)]{};
bool touch_preinit_valid[sizeof(kTouchDiagnosticRegisters)]{};

void captureTouchPreinitDiagnostics() {
  for (size_t index = 0; index < sizeof(kTouchDiagnosticRegisters); ++index) {
    touch_preinit_values[index] = 0xFF;
    touch_preinit_valid[index] =
        esp_lcd_panel_io_rx_param(touch_io, kTouchDiagnosticRegisters[index],
                                  &touch_preinit_values[index], 1) == ESP_OK;
  }
}

bool writeTouchRegister(uint8_t reg, uint8_t value) {
  return esp_lcd_panel_io_tx_param(touch_io, reg, &value, 1) == ESP_OK;
}

bool applyOfficialFT6336USettings() {
  // VIEWE's official FT62XX driver for this board writes only these four
  // working-mode parameters. In particular, do not apply the generic FT5x06
  // tuning block: several of its addresses are reserved on FT6336U.
  constexpr struct {
    uint8_t reg;
    uint8_t value;
  } settings[] = {
      {0x00, 0x00},  // Working mode
      {0xA4, 0x00},  // Polling mode
      {0x80, 22},    // VIEWE touch threshold
      {0x88, 12},    // VIEWE active report period
  };

  for (const auto &setting : settings) {
    if (!writeTouchRegister(setting.reg, setting.value)) return false;
  }
  return true;
}

bool beginVieweFT6336U() {
  esp_lcd_panel_io_i2c_config_t io_config{};
  io_config.dev_addr = 0x38;
  io_config.control_phase_bytes = 1;
  io_config.dc_bit_offset = 0;
  io_config.lcd_cmd_bits = 8;
  io_config.flags.disable_control_phase = 1;

  touch_bus = new (std::nothrow)
      esp_panel::drivers::BusI2C(41, 40, io_config);
  if (!touch_bus || !touch_bus->begin()) {
    Serial.println("VIEWE touch I2C bus begin failed");
    return false;
  }
  touch_io = touch_bus->getControlPanelHandle();
  if (!touch_io) {
    Serial.println("VIEWE touch I2C panel IO missing");
    return false;
  }
  captureTouchPreinitDiagnostics();
  if (!applyOfficialFT6336USettings()) {
    Serial.println("VIEWE official FT6336U settings failed");
    return false;
  }
  return true;
}

}  // namespace

namespace Board {

void flashStatusLed() {
  constexpr uint8_t kStatusLedPin = 42;
  // D3 is a WS2812B, not the hardwired D5 power indicator. Release RMT
  // after the boot pulse so the TF-card SPI bus can own this shared pin.
  rgbLedWrite(kStatusLedPin, 0, 16, 0);
  delay(150);
  clearStatusLed();
  Serial.println("RGB D3: boot pulse complete, LED off");
}

void clearStatusLed() {
  constexpr uint8_t kStatusLedPin = 42;
  rgbLedWrite(kStatusLedPin, 0, 0, 0);
  delayMicroseconds(300);
  rmtDeinit(kStatusLedPin);
  gpio_reset_pin(static_cast<gpio_num_t>(kStatusLedPin));
  gpio_set_direction(static_cast<gpio_num_t>(kStatusLedPin), GPIO_MODE_OUTPUT);
  gpio_set_level(static_cast<gpio_num_t>(kStatusLedPin), 0);
  Serial.println("RGB D3: off frame sent via RMT, GPIO42 held low");
}

bool beginDisplay() {
  hardware = new (std::nothrow) esp_panel::board::Board();
  if (!hardware) {
    Serial.println("VIEWE board allocation failed");
    return false;
  }

  if (!hardware->init()) {
    Serial.println("VIEWE board init failed");
    return false;
  }

  lcd = hardware->getLCD();
  backlight = hardware->getBacklight();
  if (!lcd || !backlight) {
    Serial.println("VIEWE LCD/backlight driver missing");
    return false;
  }

  auto *bus = lcd->getBus();
  if (bus && bus->getBasicAttributes().type == ESP_PANEL_BUS_TYPE_RGB) {
    auto *rgb_bus = static_cast<esp_panel::drivers::BusRGB *>(bus);
    if (!rgb_bus->configRGB_FreqHz(AZORIA_RGB_CLOCK_HZ) ||
        !rgb_bus->configRGB_BounceBufferSize(AZORIA_RGB_BOUNCE_BUFFER_SIZE)) {
      Serial.println("VIEWE stable RGB timing configuration failed");
      return false;
    }
  }

  if (!lcd->configFrameBufferNumber(2)) {
    Serial.println("VIEWE double frame buffer configuration failed");
    return false;
  }
  if (!hardware->begin()) {
    Serial.println("VIEWE board begin failed");
    return false;
  }
  current_frame_buffer = lcd->getFrameBufferByIndex(0);
  setBacklight(0);
  Serial.printf("RGB profile: %d Hz, bounce %d\n",
                AZORIA_RGB_CLOCK_HZ, AZORIA_RGB_BOUNCE_BUFFER_SIZE);
  Serial.printf(
      "RGB SDK: XIP=%d, CACHE_LINE=%d, OPT_PERF=%d, LCD_ISR_IRAM=%d, "
      "RESTART_EVERY_VSYNC=%d\n",
#if defined(CONFIG_SPIRAM_XIP_FROM_PSRAM)
      1,
#else
      0,
#endif
#if defined(CONFIG_ESP32S3_DATA_CACHE_LINE_SIZE)
      CONFIG_ESP32S3_DATA_CACHE_LINE_SIZE,
#else
      0,
#endif
#if defined(CONFIG_COMPILER_OPTIMIZATION_PERF)
      1,
#else
      0,
#endif
#if defined(CONFIG_LCD_RGB_ISR_IRAM_SAFE)
      1,
#else
      0,
#endif
#if defined(CONFIG_LCD_RGB_RESTART_IN_VSYNC)
      1
#else
      0
#endif
  );
  Serial.println("VIEWE display ready");
  return true;
}

bool beginTouch() {
  if (!beginVieweFT6336U()) {
    Serial.println("VIEWE FT6336U settings failed");
    return false;
  }

  setBacklight(220);
  Serial.println("VIEWE UEDX48480040E-WB-A ready");
  return true;
}

bool begin() {
  return beginDisplay() && beginTouch();
}

bool readTouch(uint16_t &x, uint16_t &y) {
  TouchPoint point;
  if (readTouches(&point, 1) <= 0) return false;
  x = point.x;
  y = point.y;
  return true;
}

int readTouches(TouchPoint *points, int max_points) {
  if (!touch_io || !points || max_points <= 0) return -1;

  constexpr uint8_t kTouchStatusRegister = 0x02;
  constexpr uint8_t kFirstPointRegister = 0x03;
  constexpr int kControllerMaxPoints = 2;
  constexpr uint8_t kEventPressDown = 0;
  constexpr uint8_t kEventContact = 2;

  uint8_t raw_status = 0;
  if (esp_lcd_panel_io_rx_param(touch_io, kTouchStatusRegister,
                                &raw_status, 1) != ESP_OK) {
    return -1;
  }
  const int count = raw_status & 0x0F;
  if (count == 0) return 0;
  if (count > kControllerMaxPoints) return -1;

  // Always read every point reported by the controller. Point 0 can be a
  // trailing lift-up record while point 1 is still an active contact.
  uint8_t raw[kControllerMaxPoints * 6]{};
  if (esp_lcd_panel_io_rx_param(touch_io, kFirstPointRegister, raw,
                                count * 6) != ESP_OK) {
    return -1;
  }

  int active_points = 0;
  for (int index = 0; index < count && active_points < max_points; ++index) {
    const uint8_t *point = raw + index * 6;
    // FT6336U Pn_XH[7:6] is the event flag:
    //   0 = press down, 1 = lift up, 2 = contact, 3 = no event.
    // A lift-up record may retain its previous coordinates. Treating every
    // TD_STATUS point as pressed turns that stale record into a phantom click.
    const uint8_t event = (point[0] >> 6) & 0x03;
    if (event != kEventPressDown && event != kEventContact) continue;

    const uint16_t x =
        (static_cast<uint16_t>(point[0] & 0x0F) << 8) | point[1];
    const uint16_t y =
        (static_cast<uint16_t>(point[2] & 0x0F) << 8) | point[3];
    const uint16_t raw_x = static_cast<uint16_t>(constrain(x, 0, 479));
    const uint16_t raw_y = static_cast<uint16_t>(constrain(y, 0, 479));
    switch (rotation_degrees) {
      case 90:
        points[active_points].x = raw_y;
        points[active_points].y = 479 - raw_x;
        break;
      case 180:
        points[active_points].x = 479 - raw_x;
        points[active_points].y = 479 - raw_y;
        break;
      case 270:
        points[active_points].x = 479 - raw_y;
        points[active_points].y = raw_x;
        break;
      default:
        points[active_points].x = raw_x;
        points[active_points].y = raw_y;
        break;
    }
    points[active_points].strength = -1;
    points[active_points].event = static_cast<TouchEvent>(event);
    ++active_points;
  }
  return active_points;
}

bool readTouchSnapshot(TouchSnapshot &snapshot) {
  snapshot = {};
  if (!touch_io) return false;

  constexpr uint8_t kTouchStatusRegister = 0x02;
  constexpr uint8_t kFirstPointRegister = 0x03;
  constexpr int kControllerMaxPoints = 2;

  snapshot.status = 0xFF;
  snapshot.status_result = esp_lcd_panel_io_rx_param(
      touch_io, kTouchStatusRegister, &snapshot.status, 1);
  if (snapshot.status_result != ESP_OK) return false;

  snapshot.valid = true;
  snapshot.count = snapshot.status & 0x0F;
  if (snapshot.count > 0 && snapshot.count <= kControllerMaxPoints) {
    snapshot.points_result = esp_lcd_panel_io_rx_param(
        touch_io, kFirstPointRegister, snapshot.raw, snapshot.count * 6);
  }
  return true;
}

void printTouchSnapshot(const TouchSnapshot &snapshot) {
  if (!snapshot.valid) {
    Serial.printf("TOUCH_RAW,valid=0,statusErr=%d\n",
                  snapshot.status_result);
    return;
  }

  Serial.printf("TOUCH_RAW,valid=1,status=0x%02X,count=%d,statusErr=%d,"
                "pointsErr=%d",
                snapshot.status, snapshot.count, snapshot.status_result,
                snapshot.points_result);
  const int points = snapshot.count > 2 ? 2 : snapshot.count;
  for (int index = 0; index < points; ++index) {
    const uint8_t *point = snapshot.raw + index * 6;
    const uint8_t event = (point[0] >> 6) & 0x03;
    const uint16_t x = ((point[0] & 0x0F) << 8) | point[1];
    const uint16_t y = ((point[2] & 0x0F) << 8) | point[3];
    const uint8_t id = point[2] >> 4;
    Serial.printf(",p%d=(event=%u,x=%u,y=%u,id=%u,weight=%u,area=%u)",
                  index, event, x, y, id, point[4], point[5]);
  }
  Serial.println();
}

void printTouchDiagnostics() {
  if (!touch_io) {
    Serial.println("TOUCH_DIAG,NO_IO");
    return;
  }

  Serial.print("TOUCH_PREINIT");
  for (size_t index = 0; index < sizeof(kTouchDiagnosticRegisters); ++index) {
    if (touch_preinit_valid[index]) {
      Serial.printf(",%02X=%02X", kTouchDiagnosticRegisters[index],
                    touch_preinit_values[index]);
    } else {
      Serial.printf(",%02X=ERR", kTouchDiagnosticRegisters[index]);
    }
  }
  Serial.println();

  Serial.print("TOUCH_DIAG");
  for (uint8_t reg : kTouchDiagnosticRegisters) {
    uint8_t value = 0xFF;
    esp_err_t result = esp_lcd_panel_io_rx_param(touch_io, reg, &value, 1);
    if (result == ESP_OK) {
      Serial.printf(",%02X=%02X", reg, value);
    } else {
      Serial.printf(",%02X=ERR", reg);
    }
  }
  Serial.println();
}

void setBacklight(uint8_t value) {
  if (!backlight) return;
  int percent = (static_cast<int>(value) * 100 + 127) / 255;
  backlight->setBrightness(percent);
}

void rotateFrameBufferInPlace(void *buffer, uint16_t degrees);

bool setRotation(uint16_t degrees) {
  if (degrees != 0 && degrees != 90 && degrees != 180 && degrees != 270) {
    return false;
  }
  if (degrees == rotation_degrees) return true;
  if (current_frame_buffer_is_rotated && current_frame_buffer &&
      rotation_degrees != 0) {
    const uint16_t inverse = rotation_degrees == 90
                                 ? 270
                                 : rotation_degrees == 270 ? 90 : 180;
    rotateFrameBufferInPlace(current_frame_buffer, inverse);
    current_frame_buffer_is_rotated = false;
  }
  rotation_degrees = degrees;
  return true;
}

uint16_t rotation() {
  return rotation_degrees;
}

uint16_t currentFrameBufferRotation() {
  return current_frame_buffer_is_rotated ? rotation_degrees : 0;
}

void rotateFrameBufferInPlace(void *buffer, uint16_t degrees) {
  if (!buffer || degrees == 0) return;
  auto *pixels = static_cast<uint16_t *>(buffer);
  constexpr int kSide = 480;
  if (degrees == 180) {
    for (int index = 0; index < kSide * kSide / 2; ++index) {
      const int other = kSide * kSide - 1 - index;
      const uint16_t value = pixels[index];
      pixels[index] = pixels[other];
      pixels[other] = value;
    }
    return;
  }
  for (int y = 0; y < kSide; ++y) {
    for (int x = y + 1; x < kSide; ++x) {
      const int first = y * kSide + x;
      const int second = x * kSide + y;
      const uint16_t value = pixels[first];
      pixels[first] = pixels[second];
      pixels[second] = value;
    }
  }
  if (degrees == 90) {
    for (int y = 0; y < kSide; ++y) {
      for (int x = 0; x < kSide / 2; ++x) {
        const int first = y * kSide + x;
        const int second = y * kSide + (kSide - 1 - x);
        const uint16_t value = pixels[first];
        pixels[first] = pixels[second];
        pixels[second] = value;
      }
    }
  } else {
    for (int x = 0; x < kSide; ++x) {
      for (int y = 0; y < kSide / 2; ++y) {
        const int first = y * kSide + x;
        const int second = (kSide - 1 - y) * kSide + x;
        const uint16_t value = pixels[first];
        pixels[first] = pixels[second];
        pixels[second] = value;
      }
    }
  }
}

void prepareFrameBufferForDisplay(void *buffer) {
  rotateFrameBufferInPlace(buffer, rotation_degrees);
}

void restoreFrameBufferAfterDisplay(void *buffer) {
  if (!current_frame_buffer_is_rotated || !buffer ||
      buffer == current_frame_buffer || rotation_degrees == 0) {
    return;
  }
  const uint16_t inverse = rotation_degrees == 90
                               ? 270
                               : rotation_degrees == 270 ? 90 : 180;
  rotateFrameBufferInPlace(buffer, inverse);
  current_frame_buffer_is_rotated = false;
}

void commitFrameBufferForDisplay() {
  current_frame_buffer_is_rotated = rotation_degrees != 0;
}

void copyRotatedArea(const void *source, void *destination,
                     int16_t x1, int16_t y1, int16_t x2, int16_t y2) {
  if (!source || !destination) return;
  x1 = constrain(x1, 0, 479);
  y1 = constrain(y1, 0, 479);
  x2 = constrain(x2, x1, 479);
  y2 = constrain(y2, y1, 479);
  const auto *from = static_cast<const uint16_t *>(source);
  auto *to = static_cast<uint16_t *>(destination);
  if (rotation_degrees == 0) {
    const size_t row_bytes = static_cast<size_t>(x2 - x1 + 1) * sizeof(uint16_t);
    for (int16_t y = y1; y <= y2; ++y) {
      memcpy(to + static_cast<size_t>(y) * 480 + x1,
             from + static_cast<size_t>(y) * 480 + x1, row_bytes);
    }
    return;
  }
  for (int16_t y = y1; y <= y2; ++y) {
    const size_t source_row = static_cast<size_t>(y) * 480;
    for (int16_t x = x1; x <= x2; ++x) {
      size_t destination_index = 0;
      if (rotation_degrees == 90) {
        destination_index = static_cast<size_t>(x) * 480 + (479 - y);
      } else if (rotation_degrees == 180) {
        destination_index = static_cast<size_t>(479 - y) * 480 + (479 - x);
      } else {
        destination_index = static_cast<size_t>(479 - x) * 480 + y;
      }
      to[destination_index] = from[source_row + x];
    }
  }
}

void *frameBuffer(uint8_t index) {
  return lcd ? lcd->getFrameBufferByIndex(index) : nullptr;
}

void *currentFrameBuffer() {
  return current_frame_buffer;
}

bool switchFrameBuffer(void *buffer) {
  if (!lcd || !buffer || !lcd->switchFrameBufferTo(buffer)) return false;
  current_frame_buffer = buffer;
  return true;
}

bool restartRgbScan() {
  if (!lcd || !lcd->getBus() ||
      lcd->getBus()->getBasicAttributes().type != ESP_PANEL_BUS_TYPE_RGB) {
    return false;
  }
  esp_lcd_panel_handle_t panel = lcd->getRefreshPanelHandle();
  return panel && esp_lcd_rgb_panel_restart(panel) == ESP_OK;
}

bool attachRefreshFinishCallback(RefreshFinishCallback callback, void *user_data) {
  return lcd && callback && lcd->attachRefreshFinishCallback(callback, user_data);
}

}  // namespace Board
