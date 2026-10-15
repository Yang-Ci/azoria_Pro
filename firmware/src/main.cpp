#include <Arduino.h>
#include <WiFi.h>
#include <esp_heap_caps.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <lvgl.h>
#include <time.h>

#include "features/display_control/screen.h"
#include "features/display_control/power_view.h"
#include "features/display_control/service.h"
#include "features/wallpaper/wallpaper.h"
#include "platform/board.h"
#include "platform/touch_contact_filter.h"
#include "platform/display_pixels.h"
#include "services/device_config.h"
#include "services/ble_transport.h"
#include "services/usb_provisioning.h"
#include "ui/app_ui.h"

namespace {

constexpr uint32_t kWidth = 480;
constexpr uint32_t kHeight = 480;
// A 16-row SRAM strip avoids repeatedly decompressing 16-pixel glyphs
// across eight-row clips while keeping the framebuffer itself in PSRAM.
constexpr uint32_t kDrawRows = 16;
constexpr uint32_t kBufferPixels = kWidth * kDrawRows;
lv_disp_draw_buf_t draw_buffer;
lv_color_t *draw_pixels = nullptr;
lv_area_t pending_flush_area{};
bool flush_area_pending = false;
uint32_t ui_copy_us = 0, ui_sync_us = 0, ui_wait_us = 0;
constexpr DisplayPixels::Area kPowerViewport{0, 82, 479, 479};
bool ui_scroll_reused = false, idle_viewport_stale = false;
bool last_frame_power = false;
int16_t last_power_scroll = 0;
uint32_t last_power_visual_revision = 0;
uint16_t last_power_rotation = 0, stale_viewport_rotation = 0;
bool provisioning = false;
bool have_saved_config = false;
bool remote_started = false;
DeviceConfig saved_config;
uint32_t next_wifi_retry = 0;
uint32_t next_runtime_diagnostics = 0;
volatile uint32_t display_refresh_count = 0;
volatile TickType_t display_last_refresh_tick = 0;
volatile TickType_t display_max_refresh_gap_ticks = 0;
TickType_t display_max_flush_wait_ticks = 0;
uint32_t display_recovery_count = 0;
uint32_t display_full_redraw_count = 0;
bool display_full_redraw_requested = false;
bool display_full_redraw_pending = false;
constexpr uint32_t kRuntimeDiagnosticIntervalMs = 60000;
constexpr uint32_t kWiFiRetryIntervalMs = 30000;
constexpr TickType_t kFrameBoundaryTimeout = pdMS_TO_TICKS(250);
// The FT6336U is sampled every 8 ms. A real contact persists across reports,
// while stale coordinates and electrical noise are normally isolated. Require
// two valid press/contact reports before LVGL sees a new contact. Movement
// must not restart confirmation: a light swipe can already travel between
// the first reports without ever pausing under the finger.
// LVGL still owns all click, drag and gesture state.
TouchContactFilter touch_filter;

IRAM_ATTR bool displayRefreshFinished(void *user_data) {
  TickType_t now = xTaskGetTickCountFromISR();
  TickType_t previous = display_last_refresh_tick;
  if (previous != 0) {
    TickType_t gap = now - previous;
    if (gap > display_max_refresh_gap_ticks) {
      display_max_refresh_gap_ticks = gap;
    }
  }
  display_last_refresh_tick = now;
  display_refresh_count = display_refresh_count + 1;
  BaseType_t should_yield = pdFALSE;
  vTaskNotifyGiveFromISR(static_cast<TaskHandle_t>(user_data), &should_yield);
  return should_yield == pdTRUE;
}

bool presentFrame(void *target) {
  if (!Board::switchFrameBuffer(target)) {
    Serial.println("LCD frame switch failed");
    Serial.flush();
    delay(20);
    ESP.restart();
    return false;
  }
  // Match the panel library's supported double-buffer sequence. Never release
  // the off-screen buffer until a refresh boundary has actually completed.
  ulTaskNotifyValueClear(nullptr, ULONG_MAX);
  TickType_t wait_started = xTaskGetTickCount();
  if (ulTaskNotifyTake(pdTRUE, kFrameBoundaryTimeout) == 0) {
    // A stalled RGB callback must not leave the LVGL task blocked forever.
    // Ask the driver to resynchronise at the next VSYNC, and still keep
    // ownership of the framebuffer until a real boundary arrives.
    Serial.println("LCD frame boundary timeout; requesting RGB resync");
    ++display_recovery_count;
    if (!Board::restartRgbScan()) {
      Serial.println("LCD RGB resync request failed; rebooting");
      Serial.flush();
      delay(20);
      ESP.restart();
      return false;
    }
    ulTaskNotifyValueClear(nullptr, ULONG_MAX);
    if (ulTaskNotifyTake(pdTRUE, kFrameBoundaryTimeout) == 0) {
      Serial.println("LCD RGB resync timed out; rebooting");
      Serial.flush();
      delay(20);
      ESP.restart();
      return false;
    }
    Serial.println("LCD RGB scan recovered");
    display_full_redraw_requested = true;
  }
  TickType_t wait_ticks = xTaskGetTickCount() - wait_started;
  if (wait_ticks > display_max_flush_wait_ticks) {
    display_max_flush_wait_ticks = wait_ticks;
  }
  Board::commitFrameBufferForDisplay();
  return true;
}

void displayRenderStart(lv_disp_drv_t *) {
  ui_scroll_reused = false;
  lv_disp_t *display = lv_disp_get_default();
  auto *source = static_cast<const uint16_t *>(Board::currentFrameBuffer());
  auto *target = static_cast<uint16_t *>(Board::currentFrameBuffer() == Board::frameBuffer(0)
                                           ? Board::frameBuffer(1) : Board::frameBuffer(0));
  const bool power = DisplayControl::PowerView::active();
  const int16_t scroll = DisplayControl::PowerView::scrollOffset();
  const int delta = scroll - last_power_scroll;
  const bool surface_unchanged = power && last_frame_power &&
      last_power_rotation == Board::rotation() &&
      last_power_visual_revision == DisplayControl::PowerView::visualRevision();
  if (source && target && surface_unchanged && delta != 0 &&
      display->inv_p == 1 && !display->inv_area_joined[0]) {
    lv_area_t &area = display->inv_areas[0];
    // Scroll invalidation includes a small external margin. Header controls
    // have their own visual revision and therefore always use normal drawing.
    if (area.x1 == 0 && area.x2 == 479 && area.y1 >= 74 && area.y2 == 479) {
      const uint32_t started = micros();
      ui_scroll_reused = DisplayPixels::copyScrolledArea(
          source, target, 480, kPowerViewport, delta, Board::rotation());
      ui_copy_us += micros() - started;
      if (ui_scroll_reused) {
        area = {0, static_cast<lv_coord_t>(delta > 0 ? 480 - delta : 82),
                479, static_cast<lv_coord_t>(delta > 0 ? 479 : 81 - delta)};
        return;
      }
    }
  }
  // A reused frame fully overwrites its viewport, so it needs no second copy
  // after presentation. Before the next normal partial redraw, reconcile the
  // idle viewport once. The visible framebuffer is never modified here.
  if (idle_viewport_stale && source && target) {
    const uint32_t started = micros();
    DisplayPixels::syncArea(source, target, 480, kPowerViewport, stale_viewport_rotation);
    ui_sync_us += micros() - started;
    idle_viewport_stale = false;
  }
}

void displayFlush(lv_disp_drv_t *driver, const lv_area_t *area, lv_color_t *colors) {
  void *previous_frame_buffer = Board::currentFrameBuffer();
  void *target = previous_frame_buffer == Board::frameBuffer(0)
                     ? Board::frameBuffer(1) : Board::frameBuffer(0);
  if (!previous_frame_buffer || !target || !colors) {
    Serial.println("LCD frame buffer unavailable");
    Serial.flush();
    delay(20);
    ESP.restart();
    return;
  }
  const uint32_t copy_started = micros();
  Board::copyDrawAreaToFrameBuffer(colors, target, area->x1, area->y1,
                                  area->x2, area->y2);
  ui_copy_us += micros() - copy_started;
  if (!flush_area_pending) {
    pending_flush_area = *area;
    flush_area_pending = true;
  } else {
    pending_flush_area.x1 = min(pending_flush_area.x1, area->x1);
    pending_flush_area.y1 = min(pending_flush_area.y1, area->y1);
    pending_flush_area.x2 = max(pending_flush_area.x2, area->x2);
    pending_flush_area.y2 = max(pending_flush_area.y2, area->y2);
  }
  if (!lv_disp_flush_is_last(driver)) {
    lv_disp_flush_ready(driver);
    return;
  }
  const uint32_t wait_started = micros();
  if (!Board::presentFrameBuffer(target)) return;
  ui_wait_us += micros() - wait_started;
  if (ui_scroll_reused) {
    idle_viewport_stale = true;
    stale_viewport_rotation = Board::rotation();
  } else {
    const uint32_t sync_started = micros();
    Board::syncFrameBufferArea(target, previous_frame_buffer,
                               pending_flush_area.x1, pending_flush_area.y1,
                               pending_flush_area.x2, pending_flush_area.y2);
    ui_sync_us += micros() - sync_started;
  }
  flush_area_pending = false;
  lv_disp_flush_ready(driver);
}

void displayMonitor(lv_disp_drv_t *, uint32_t elapsed_ms, uint32_t pixels) {
  if (DisplayControl::PowerView::scrollDiagnosticsActive() &&
      (ui_scroll_reused || pixels >= 480 * 80)) {
    Serial.printf("POWER_FRAME,ms=%lu,pixels=%lu,copy_us=%lu,sync_us=%lu,wait_us=%lu,reuse=%u\n",
                  static_cast<unsigned long>(elapsed_ms), static_cast<unsigned long>(pixels),
                  static_cast<unsigned long>(ui_copy_us), static_cast<unsigned long>(ui_sync_us),
                  static_cast<unsigned long>(ui_wait_us), ui_scroll_reused ? 1 : 0);
  }
  last_frame_power = DisplayControl::PowerView::active();
  last_power_scroll = DisplayControl::PowerView::scrollOffset();
  last_power_visual_revision = DisplayControl::PowerView::visualRevision();
  last_power_rotation = Board::rotation();
  ui_copy_us = ui_sync_us = ui_wait_us = 0;
}

void logMemory(const char *stage) {
  Serial.printf(
      "MEMORY,%s,INTERNAL_FREE=%u,INTERNAL_MIN=%u,INTERNAL_LARGEST=%u,"
      "PSRAM_FREE=%u,PSRAM_LARGEST=%u,REFRESH_COUNT=%lu,"
      "REFRESH_MAX_GAP_MS=%lu,FLUSH_MAX_WAIT_MS=%lu,RGB_RECOVERIES=%lu,"
      "FULL_REDRAWS=%lu,MAIN_STACK_FREE=%u\n",
      stage,
      static_cast<unsigned>(
          heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
      static_cast<unsigned>(
          heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL |
                                          MALLOC_CAP_8BIT)),
      static_cast<unsigned>(
          heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL |
                                           MALLOC_CAP_8BIT)),
      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)),
      static_cast<unsigned>(
          heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM)),
      static_cast<unsigned long>(display_refresh_count),
      static_cast<unsigned long>(
          display_max_refresh_gap_ticks * portTICK_PERIOD_MS),
      static_cast<unsigned long>(
          display_max_flush_wait_ticks * portTICK_PERIOD_MS),
      static_cast<unsigned long>(display_recovery_count),
      static_cast<unsigned long>(display_full_redraw_count),
      static_cast<unsigned>(uxTaskGetStackHighWaterMark(nullptr)));
}

void touchRead(lv_indev_drv_t *, lv_indev_data_t *data) {
  static bool wake_contact_consumed=false;
  Board::TouchPoint point{};
  const int count = Board::readTouches(&point, 1);
  if (DisplayControl::screenSleeping()) {
    if(count>0){DisplayControl::wakeScreenTemporarily();wake_contact_consumed=true;}
    touch_filter.reset();
    data->state = LV_INDEV_STATE_REL;
    return;
  }
  if(wake_contact_consumed){
    if(count==0)wake_contact_consumed=false;
    touch_filter.reset();data->state=LV_INDEV_STATE_REL;return;
  }
  if (touch_filter.update(count, point)) {
    DisplayControl::noteInteraction();
    data->state = LV_INDEV_STATE_PR;
    data->point.x = touch_filter.point().x;
    data->point.y = touch_filter.point().y;
    return;
  }

  data->state = LV_INDEV_STATE_REL;
}

void tick(void *) {
  lv_tick_inc(2);
}

bool initLvgl() {
  AppUi::init();
  if (!Board::frameBuffer(0) || !Board::frameBuffer(1)) {
    Serial.println("LCD double frame buffers unavailable");
    return false;
  }
  draw_pixels = static_cast<lv_color_t *>(heap_caps_malloc(
      kBufferPixels * sizeof(lv_color_t), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  if (!draw_pixels) {
    Serial.println("LCD internal draw buffer unavailable");
    return false;
  }
  if (!Board::attachRefreshFinishCallback(displayRefreshFinished,
                                           xTaskGetCurrentTaskHandle())) {
    Serial.println("LCD VSYNC callback setup failed");
    return false;
  }
  lv_disp_draw_buf_init(&draw_buffer, draw_pixels, nullptr, kBufferPixels);

  static lv_disp_drv_t display_driver;
  lv_disp_drv_init(&display_driver);
  display_driver.hor_res = kWidth;
  display_driver.ver_res = kHeight;
  display_driver.flush_cb = displayFlush;
  display_driver.render_start_cb = displayRenderStart;
  display_driver.monitor_cb = displayMonitor;
  display_driver.draw_buf = &draw_buffer;
  // LVGL renders small logical regions in SRAM. The flush path rotates only
  // those regions into the idle physical panel buffer and owns presentation.
  lv_disp_t *display = lv_disp_drv_register(&display_driver);
  if (!display) {
    Serial.println("LVGL display registration failed");
    return false;
  }
  AppUi::displayReady();

  static lv_indev_drv_t input_driver;
  lv_indev_drv_init(&input_driver);
  input_driver.type = LV_INDEV_TYPE_POINTER;
  input_driver.read_cb = touchRead;
  input_driver.long_press_time = 800;
  lv_indev_t *input = lv_indev_drv_register(&input_driver);
  if (!input) {
    Serial.println("LVGL touch input registration failed");
    return false;
  }
  lv_timer_set_period(input->driver->read_timer, 8);

  const esp_timer_create_args_t timer_args = {
      .callback = tick,
      .name = "lvgl-tick",
  };
  esp_timer_handle_t timer;
  esp_timer_create(&timer_args, &timer);
  esp_timer_start_periodic(timer, 2000);
  return true;
}

void beginWiFi(const DeviceConfig &config) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(config.ssid.c_str(), config.password.c_str());
  Serial.printf("Connecting to %s", config.ssid.c_str());
}

bool waitForWiFi() {
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    lv_timer_handler();
    delay(20);
    if ((millis() / 500) % 2 == 0) Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi ready: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  return false;
}

void startProvisioning() {
  provisioning = true;
  AppUi::showProvisioning();
}

}  // namespace

namespace Board {
bool presentFrameBuffer(void *buffer) { return presentFrame(buffer); }
}  // namespace Board

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nAzoria Display Controller");

  Board::flashStatusLed();
  if (!Board::beginDisplay()) {
    Serial.println("Fatal display initialization error");
    return;
  }
  // Match the official VIEWE sequence: mount the TF card after LCD
  // initialization, but before LVGL and the touch controller take the bus.
  Board::setBacklight(0);
  delay(150);
  Wallpaper::begin();
  if (!initLvgl()) {
    Serial.println("Fatal display initialization error");
    return;
  }
  if (!Board::beginTouch()) {
    Serial.println("Fatal touch initialization error");
    return;
  }
  logMemory("display-ready");
  beginUsbProvisioning();

  DeviceConfig config;
  if (!loadDeviceConfig(config)) {
    startProvisioning();
    return;
  }

  saved_config = config;
  have_saved_config = !saved_config.ssid.isEmpty();
  if (have_saved_config) {
    beginWiFi(saved_config);
  }
  DisplayControl::showScreen();
  // The BLE host is configured to use PSRAM for dynamic allocations, so both
  // radios remain available without starving RGB DMA.
  DisplayControl::startRemote(saved_config);
  remote_started = true;
  if (!have_saved_config) {
    Serial.println("BLE-only mode: waiting for Desktop connection");
  } else {
    if (waitForWiFi()) {
      logMemory("network-ready");
    } else {
      // Keep the saved station credentials and recover automatically if the
      // router was merely unavailable during boot. USB provisioning remains
      // available in parallel if the saved credentials really are wrong.
      Serial.println("Wi-Fi unavailable; retrying saved network in background");
      next_wifi_retry = millis() + kWiFiRetryIntervalMs;
    }
  }
  next_runtime_diagnostics = millis() + kRuntimeDiagnosticIntervalMs;
}

void loop() {
  bleTransportLoop();
  lv_timer_handler();
  display_full_redraw_pending |= display_full_redraw_requested;
  display_full_redraw_requested = false;
  display_full_redraw_pending |= DisplayControl::takeFullRedrawRequest();
  usbProvisioningLoop();
  if (have_saved_config) {
    if (WiFi.status() == WL_CONNECTED) {
      next_wifi_retry = millis() + kWiFiRetryIntervalMs;
    } else if (static_cast<int32_t>(millis() - next_wifi_retry) >= 0) {
      Serial.println("Retrying saved Wi-Fi network");
      // Give each station attempt enough time to finish. Reissuing reconnect
      // every few seconds can continuously restart association on a weak AP.
      WiFi.disconnect(false, false);
      WiFi.begin(saved_config.ssid.c_str(), saved_config.password.c_str());
      next_wifi_retry = millis() + kWiFiRetryIntervalMs;
    }
  }
  if (!provisioning) {
    DisplayControl::refresh();
  }
  lv_disp_t *display = lv_disp_get_default();
  lv_disp_draw_buf_t *active_draw_buffer =
      (display != nullptr && display->driver != nullptr)
          ? display->driver->draw_buf
          : nullptr;
  if (display_full_redraw_pending && !Wallpaper::directPresentation() &&
      display != nullptr &&
      active_draw_buffer != nullptr && active_draw_buffer->buf1 != nullptr &&
      !display->rendering_in_progress &&
      !active_draw_buffer->flushing && lv_anim_count_running() == 0) {
    display_full_redraw_pending = false;
    lv_obj_invalidate(lv_disp_get_scr_act(display));
    lv_refr_now(display);
    ++display_full_redraw_count;
  }

  if (static_cast<int32_t>(millis() - next_runtime_diagnostics) >= 0) {
    logMemory("runtime");
    next_runtime_diagnostics = millis() + kRuntimeDiagnosticIntervalMs;
  }
  delay(Wallpaper::directPresentation() ? 1 : 5);
}
