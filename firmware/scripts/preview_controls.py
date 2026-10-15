"""Render the actual home/adjustment panels with desktop LVGL, without a device.

Requires GCC/G++ and Pillow. Reuses LVGL objects from preview_usage.py when present.
"""
from pathlib import Path
import concurrent.futures
import hashlib
import os
import shutil
import subprocess
from PIL import Image

root = Path(__file__).resolve().parents[2]
build = root / "out/touch-controls-preview"
build.mkdir(parents=True, exist_ok=True)
lvgl = root / "firmware/.pio/libdeps/viewe_uedx48480040e_wb_a/lvgl"
gcc, cxx = shutil.which("gcc"), shutil.which("g++")
if not gcc or not cxx:
    raise SystemExit("GCC and G++ are required for the LVGL preview")
(build / "Arduino.h").write_text('''#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <algorithm>
using String = std::string;
using std::min;
using std::max;
template<class T> T constrain(T v, T lo, T hi) { return std::max(lo, std::min(v, hi)); }
uint32_t millis();
struct NativeSerial { template<class... T> void printf(const char *, T...) {} void flush() {} void println(const char *) {} };
inline void delay(uint32_t) {}
struct NativeEsp { void restart() { abort(); } };
inline NativeEsp ESP;
inline NativeSerial Serial;
''', encoding="utf-8")
(build / "Preferences.h").write_text('''#pragma once
class Preferences {
 public:
  bool begin(const char *, bool = false) { return true; }
  void end() {}
  int getInt(const char *, int value) { return value; }
  uint16_t getUShort(const char *, uint16_t value) { return value; }
  void putInt(const char *, int) {}
  void putUShort(const char *, uint16_t) {}
};
''', encoding="utf-8")
(build / "WiFi.h").write_text("#pragma once\n", encoding="utf-8")
(build / "esp_heap_caps.h").write_text('''#pragma once
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
inline void *heap_caps_calloc(size_t n, size_t size, int) { return calloc(n, size); }
''', encoding="utf-8")

(build / "preview.cpp").write_text(r'''
#include <lvgl.h>
#include <cassert>
#include <cstdio>
#include <ctime>
#include <vector>
#include "features/display_control/service.h"
#include "features/wallpaper/wallpaper.h"
#include "platform/display_pixels.h"
uint32_t clock_ms = 100000;
uint32_t millis() { return clock_ms; }
uint32_t micros() { return clock_ms * 1000; }
DisplayControl::RemoteState fixture;
struct Command { std::string control; int value; bool final_value; };
std::vector<Command> commands;
uint8_t applied_backlight = 0;
int selected_bluetooth_device = -1;
bool power_view_active = false;
std::vector<std::string> input_requests;
namespace Board {
lv_color_t panel_frames[2][480 * 480];
int visible_frame = 0;
void *frameBuffer(uint8_t index) { return panel_frames[index]; }
void *currentFrameBuffer() { return panel_frames[visible_frame]; }
bool presentFrameBuffer(void *target) { visible_frame = target == panel_frames[0] ? 0 : 1; return true; }
void copyDrawAreaToFrameBuffer(const void *source, void *target, int16_t x1, int16_t y1, int16_t x2, int16_t y2) {
  DisplayPixels::writeArea(static_cast<const uint16_t *>(source), static_cast<uint16_t *>(target), 480, {x1,y1,x2,y2}, 0);
}
void syncFrameBufferArea(const void *source, void *target, int16_t x1, int16_t y1, int16_t x2, int16_t y2) {
  DisplayPixels::syncArea(static_cast<const uint16_t *>(source), static_cast<uint16_t *>(target), 480, {x1,y1,x2,y2}, 0);
}
void setBacklight(uint8_t value) { applied_backlight = value; }
bool setRotation(uint16_t) { return true; }
uint16_t rotation() { return 0; }
}
namespace DisplayControl {
RemoteState getRemoteState() { return fixture; }
bool queueNumericControl(const char *control, int value, bool final_value) {
  commands.push_back({control, value, final_value}); return true;
}
bool queueBooleanControl(const char *, bool) { return true; }
bool queueStringControl(const char *control, const char *value) {
  assert(!strcmp(control,"input"));input_requests.push_back(value);
  fixture.input_pending=true;++fixture.revision;return true;
}
bool queueMusicControl(const char *, uint32_t) { return true; }
bool queuePowerControl(const char *action) {
  commands.push_back({action,0,true}); fixture.power_pending = true; return true;
}
void selectBluetoothDevice(uint8_t index) {
  selected_bluetooth_device = index; fixture.bluetooth_pending = true;
}
void copyMusicArtwork(uint8_t *, size_t) {}
void selectUsageProvider(uint8_t) {}
void requestUsageSync() {}
void setComputerViewActive(bool) {}
void setPowerViewActive(bool active) { power_view_active=active; }
}
namespace Wallpaper {
void createView(lv_obj_t *, lv_event_cb_t) {}
void show() {}
void hide() {}
bool active() { return false; }
void refresh() {}
}
static tm *native_localtime(const time_t *t, tm *result) { *result = *std::localtime(t); return result; }
#define localtime_r native_localtime
// Include production code so the preview can open the same gesture-driven panels.
#include "features/display_control/screen.cpp"
lv_color_t draw_pixels[480 * 16];
lv_area_t pending_flush_area{};
bool flush_area_pending = false;
// PRODUCTION_PRESENTATION_GLOBALS
// PRODUCTION_PRESENTATION_CALLBACKS
uint32_t checked_reuse_frames = 0;
uint32_t rendered_frames = 0;
lv_point_t pointer_point{};
bool pointer_pressed = false;
void readPointer(lv_indev_drv_t *, lv_indev_data_t *data) {
  data->point = pointer_point;
  data->state = pointer_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}
void flush(lv_disp_drv_t *driver, const lv_area_t *area, lv_color_t *pixels) {
  const bool last = lv_disp_flush_is_last(driver);
  displayFlush(driver, area, pixels);
  if (last) ++rendered_frames;
}
void checkMonitor(lv_disp_drv_t *driver, uint32_t elapsed, uint32_t pixels) {
  displayMonitor(driver, elapsed, pixels);
  if (!ui_scroll_reused) return;
  // Compare the actual production presentation callbacks with an independent
  // complete LVGL snapshot, not with another incremental-render implementation.
  std::vector<lv_color_t> reference(480 * 480);
  lv_img_dsc_t snapshot{};
  assert(lv_snapshot_take_to_buf(lv_scr_act(), LV_IMG_CF_TRUE_COLOR, &snapshot,
                                reference.data(), reference.size() * sizeof(lv_color_t)) == LV_RES_OK);
  assert(!memcmp(reference.data(), Board::currentFrameBuffer(), reference.size() * sizeof(lv_color_t)));
  ++checked_reuse_frames;
}
void advance(uint32_t duration) {
  while (duration) {
    const uint32_t step = std::min(duration, 20u);
    duration -= step; clock_ms += step; lv_tick_inc(step); lv_timer_handler();
    if (DisplayControl::PowerView::active()) DisplayControl::refresh();
  }
}
void capture(const char *name) {
  lv_obj_update_layout(lv_scr_act()); lv_refr_now(nullptr);
  FILE *file = fopen(name, "wb"); assert(file);
  fprintf(file, "P6\n480 480\n255\n");
  for (int index = 0; index < 480 * 480; ++index) {
    const auto pixel = static_cast<lv_color_t *>(Board::currentFrameBuffer())[index];
    const uint16_t v = pixel.full;
    const uint8_t rgb[] = {uint8_t(((v >> 11) & 31) * 255 / 31), uint8_t(((v >> 5) & 63) * 255 / 63), uint8_t((v & 31) * 255 / 31)};
    fwrite(rgb, 1, 3, file);
  }
  fclose(file);
}
void pointerAt(int x, int y, bool pressed) {
  pointer_point = {static_cast<lv_coord_t>(x), static_cast<lv_coord_t>(y)};
  pointer_pressed = pressed;
  advance(40);
}
void assertHome() {
  assert(!DisplayControl::UsageView::active());
  assert(!DisplayControl::ComputerView::active());
}
void assertBounds(lv_obj_t *object) {
  lv_area_t a, p; lv_obj_get_coords(object, &a); lv_obj_get_coords(lv_obj_get_parent(object), &p);
  assert(a.x1 >= p.x1 && a.x2 <= p.x2 && a.y1 >= p.y1 && a.y2 <= p.y2);
}
lv_obj_t *findLabel(lv_obj_t *parent, const char *value) {
  if (lv_obj_has_flag(parent, LV_OBJ_FLAG_HIDDEN)) return nullptr;
  if (lv_obj_check_type(parent, &lv_label_class) && !strcmp(lv_label_get_text(parent), value)) return parent;
  for (uint32_t i = 0; i < lv_obj_get_child_cnt(parent); ++i) {
    if (auto *found = findLabel(lv_obj_get_child(parent, i), value)) return found;
  }
  return nullptr;
}
void assertLabel(const char *value) {
  auto *label = findLabel(lv_scr_act(), value); assert(label); assertBounds(label);
  assert(lv_obj_get_width(label) >= lv_txt_get_width(value, strlen(value),
    lv_obj_get_style_text_font(label, 0), lv_obj_get_style_text_letter_space(label, 0), LV_TEXT_FLAG_NONE));
}
void assertPowerButtons(bool off_disabled, bool on_disabled, bool link_disabled) {
  const char *labels[] = {"熄灭外接屏", "恢复外接屏", "与 Touch 定时息屏联动"};
  const bool expected[] = {off_disabled, on_disabled, link_disabled};
  for (int i = 0; i < 3; ++i) {
    auto *label = findLabel(lv_scr_act(), labels[i]); assert(label);
    assert(lv_obj_has_state(lv_obj_get_parent(label), LV_STATE_DISABLED) == expected[i]);
  }
}
void renderPower(const char *name) {
  DisplayControl::PowerView::refresh(fixture); advance(120); capture(name);
  for (const char *value : {"电源管理", "外接屏电源", "电脑电池", "电源模式", "与 Touch 定时息屏联动"}) assertLabel(value);
}
int main() {
  lv_init();
  lv_disp_draw_buf_t draw; lv_disp_draw_buf_init(&draw, draw_pixels, nullptr, 480 * 16);
  lv_disp_drv_t driver; lv_disp_drv_init(&driver);
  driver.hor_res = 480; driver.ver_res = 480; driver.draw_buf = &draw; driver.flush_cb = flush;
  driver.render_start_cb = displayRenderStart; driver.monitor_cb = checkMonitor;
  lv_disp_drv_register(&driver);
  lv_indev_drv_t pointer_driver; lv_indev_drv_init(&pointer_driver);
  pointer_driver.type = LV_INDEV_TYPE_POINTER; pointer_driver.read_cb = readPointer;
  lv_indev_drv_register(&pointer_driver);
  lv_obj_set_style_bg_color(lv_scr_act(), lv_color_hex(0x000000), 0);
  lv_obj_set_style_pad_all(lv_scr_act(), 0, 0);
  fixture.ready = fixture.online = fixture.music_available = fixture.music_playing = true;
  strcpy(fixture.message, "DDC connected");
  fixture.brightness = 72; fixture.volume = 64;
  fixture.music_duration_ms = 240000; fixture.music_position_ms = 45000;
  strcpy(fixture.music_title, "星夜"); strcpy(fixture.music_artist, "YangCi Demo");
  strcpy(fixture.music_lyric_previous, "星光落在窗前");
  strcpy(fixture.music_lyric_current, "晚风轻轻掠过");
  strcpy(fixture.music_lyric_next, "把今天唱成一首歌");
  fixture.music_artwork_accent = 0x80BFEA;
  using namespace DisplayControl;
  showScreen(); refresh(); advance(550);
  // Exercise real pointer input, including LVGL's gesture/click ordering.
  for (int x : {220, 360}) {
    pointerAt(x, 40, true); pointerAt(x, 40, false);
    assert(x == 220 ? UsageView::active() : ComputerView::active());
    UsageView::hide(); ComputerView::hide(); advance(200);
    pointerAt(x, 40, true); pointerAt(x + 4, 44, true); pointerAt(x + 4, 44, false);
    assert(x == 220 ? UsageView::active() : ComputerView::active());
    UsageView::hide(); ComputerView::hide(); advance(200);
    // Short movement never reaches LVGL's gesture threshold, but is not a tap.
    pointerAt(x, 35, true); pointerAt(x, 49, true); pointerAt(x, 49, false);
    assertHome(); assert(lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN));
    // Moving away then returning must remain cancelled.
    pointerAt(x, 35, true); pointerAt(x + 18, 35, true);
    pointerAt(x, 35, true); pointerAt(x, 35, false); assertHome();
    // Pull down from an entry and release while still within its original hit area.
    pointerAt(x, 23, true); pointerAt(x, 90, true); pointerAt(x, 59, true);
    pointerAt(x, 59, false); assertHome();
    assert(!lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN));
    hideBacklightPanel(); advance(200);
    // Pull down past the button, cross the overlay, then release.
    pointerAt(x, 35, true); pointerAt(x, 65, true); pointerAt(x, 105, true);
    pointerAt(x, 150, true); pointerAt(x, 150, false); assertHome();
    assert(!lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN));
    hideBacklightPanel(); advance(200);
    // A subsequent independent tap remains usable after a consumed swipe.
    pointerAt(x, 40, true); pointerAt(x, 40, false);
    assert(x == 220 ? UsageView::active() : ComputerView::active());
    UsageView::hide(); ComputerView::hide(); advance(200);
  }
  // The existing home layout is preserved apart from the native Linux icon.
  capture("touch-home.ppm");
  // A source tap highlights immediately while RemoteState retains the last ACK.
  pointerAt(185,410,true);pointerAt(185,410,false);
  assert(input_requests.size()==1 && input_requests.back()=="hdmi1");
  assert(pending_input==1 && active_input==3 && !strcmp(fixture.input,"usbc"));
  assert(lv_obj_get_style_bg_color(input_buttons[1],0).full==lv_color_hex(0xE1F4FF).full);
  assert(lv_obj_get_style_bg_color(input_buttons[3],0).full==lv_color_hex(0x1D1D1D).full);
  assert(!strcmp(lv_label_get_text(footer_text),"正在切换信号源"));
  refresh();advance(120);capture("touch-input-pending.ppm");
  assert(pending_input==1);  // An old heartbeat cannot undo a pending selection.
  pointerAt(185,410,true);pointerAt(185,410,false);assert(input_requests.size()==1);
  // A second choice, including a return to the acknowledged source, is immediate.
  pointerAt(300,410,true);pointerAt(300,410,false);assert(input_requests.back()=="hdmi2");
  pointerAt(65,410,true);pointerAt(65,410,false);assert(input_requests.back()=="usbc" && pending_input==3);
  fixture.input_pending=false;++fixture.revision;refresh();assert(pending_input==-1 && active_input==3);
  pointerAt(185,410,true);pointerAt(185,410,false);
  fixture.input_pending=false;strcpy(fixture.message,"input verification failed");++fixture.revision;refresh();
  assert(pending_input==-1 && active_input==3);
  assert(lv_obj_get_style_bg_color(input_buttons[3],0).full==lv_color_hex(0xE1F4FF).full);
  assert(!strcmp(lv_label_get_text(footer_text),"切换失败"));capture("touch-input-failed.ppm");
  // A horizontal drag remains a scroll, with no source command on release.
  auto inputs_before=input_requests.size();
  pointerAt(185,410,true);pointerAt(160,410,true);pointerAt(130,410,false);advance(400);
  assert(input_requests.size()==inputs_before);
  lv_obj_scroll_to_x(input_strip,0,LV_ANIM_OFF);advance(400);
  strcpy(fixture.message,"DDC connected");++fixture.revision;refresh();
  fixture.power_supported=true;fixture.external_screen_count=2;fixture.battery_percent=100;
  fixture.power_data_available=true;fixture.bluetooth_available=true;fixture.bluetooth_count=3;
  fixture.bluetooth_percent=86;strcpy(fixture.bluetooth_name,"罗技 MX Master 3S");
  strcpy(fixture.battery_status,"full");strcpy(fixture.power_mode,"performance");
  pointerAt(220,98,true);pointerAt(220,98,false);assert(PowerView::active());
  assert(power_view_active);
  renderPower("touch-power.ppm");
  // A live but unchanged page must not continuously repaint while waiting for
  // desktop samples. Unrelated music updates must not repaint behind the page.
  advance(200);
  const auto quiet_frames = rendered_frames;
  for (int i = 0; i < 50; ++i) {
    ++fixture.revision; fixture.music_position_ms += 20;
    refresh(); advance(20);
  }
  printf("Power idle redraws in one second: %u\n", rendered_frames - quiet_frames);
  fflush(stdout);
  assert(rendered_frames == quiet_frames);
  // Expanded hit area accepts a light tap outside the visible 44-pixel button.
  pointerAt(405, 12, true); pointerAt(407, 14, true); pointerAt(407, 14, false);
  assert(!PowerView::active()); assert(!power_view_active);
  pointerAt(220,98,true);pointerAt(220,98,false);assert(PowerView::active());

  assertLabel("100%"); assertLabel("已充满"); assertLabel("性能模式");
  assertLabel("2 块 · 正常显示"); assertPowerButtons(false, true, false);
  assertLabel("蓝牙设备电量");assertLabel("罗技 MX Master 3S");assertLabel("86%");assertLabel("1 / 3");
  pointerAt(420,382,true);pointerAt(420,382,false);assert(selected_bluetooth_device==1);
  assertLabel("正在读取设备电量");
  selected_bluetooth_device=-1;
  pointerAt(420,382,true);pointerAt(420,382,false);assert(selected_bluetooth_device==-1);
  fixture.bluetooth_pending=false;fixture.bluetooth_index=1;fixture.bluetooth_percent=-1;
  strcpy(fixture.bluetooth_name,"蓝牙键盘");renderPower("touch-power-bluetooth-unknown.ppm");
  assertLabel("2 / 3");assertLabel("未提供电量");
  pointerAt(370,382,true);pointerAt(370,382,false);assert(selected_bluetooth_device==0);
  fixture.bluetooth_pending=false;fixture.bluetooth_index=0;fixture.bluetooth_percent=0;
  PowerView::refresh(fixture);advance(120);assertLabel("0%");
  fixture.bluetooth_percent=86;strcpy(fixture.bluetooth_name,"罗技 MX Master 3S");PowerView::refresh(fixture);
  // A tap in the overlay's empty space must not reach home controls behind it.
  pointerAt(220,80,true);pointerAt(220,80,false);assert(PowerView::active());
  assert(commands.empty());
  pointerAt(120,206,true);pointerAt(120,206,false);assert(commands.back().control=="off");
  assertLabel("正在应用设置"); assertPowerButtons(true, true, true);
  pointerAt(120,206,true);pointerAt(120,206,false);assert(commands.size()==1);
  renderPower("touch-power-pending.ppm");
  fixture.power_pending=false;fixture.external_screens_off=true;
  fixture.external_power_linked=true;fixture.touch_sleep_enabled=true;
  fixture.touch_sleep_start_minutes=23*60+41;fixture.touch_sleep_end_minutes=11*60+42;
  fixture.battery_percent=18;strcpy(fixture.battery_status,"discharging");strcpy(fixture.power_mode,"power-saver");
  renderPower("touch-power-linked.ppm");
  assertLabel("18%");assertLabel("使用电池");assertLabel("节电模式");assertLabel("2 块 · 已熄灭");
  assertLabel("23:41 - 11:42 · 到时自动熄灭 / 恢复");assertPowerButtons(true,false,false);
  pointerAt(340,206,true);pointerAt(340,206,false);assert(commands.back().control=="on");
  fixture.power_pending=false;fixture.external_screens_off=false;PowerView::refresh(fixture);
  // Swipe the actual touch viewport to reveal the schedule card; the header stays fixed.
  auto *title=findLabel(lv_scr_act(),"电源管理");lv_area_t title_before;lv_obj_get_coords(title,&title_before);
  auto *schedule=lv_obj_get_parent(findLabel(lv_scr_act(),"与 Touch 定时息屏联动"));
  auto *scroll=lv_obj_get_parent(schedule);
  auto count=commands.size();
  pointerAt(100,440,true);pointerAt(100,380,true);pointerAt(100,300,true);pointerAt(100,220,true);pointerAt(100,220,false);
  advance(400);assert(lv_obj_get_scroll_y(scroll)>0);assert(commands.size()==count);
  lv_area_t title_after;lv_obj_get_coords(title,&title_after);assert(title_before.y1==title_after.y1);
  lv_obj_scroll_to_view(schedule,LV_ANIM_OFF);advance(120);capture("touch-power-schedule.ppm");
  pointerAt(420,398,true);pointerAt(420,398,false);assert(commands.back().control=="link-off");
  fixture.power_pending=false;fixture.external_power_linked=false;PowerView::refresh(fixture);
  pointerAt(170,430,true);pointerAt(170,430,false);assert(commands.back().control=="link-on");
  fixture.power_pending=false;fixture.power_busy=true;
  renderPower("touch-power-busy.ppm");assertPowerButtons(true,true,true);
  fixture.power_busy=false;fixture.online=false;
  renderPower("touch-power-offline.ppm");assertLabel("等待桌面端连接");assertPowerButtons(true,true,true);
  count=commands.size();pointerAt(420,398,true);pointerAt(420,398,false);assert(commands.size()==count);
  fixture.online=true;fixture.power_supported=false;
  renderPower("touch-power-unsupported.ppm");assertLabel("外接屏控制暂不可用");assertPowerButtons(true,true,true);
  assertLabel("18%");assertLabel("罗技 MX Master 3S");  // Battery data is independent of monitor control support.
  fixture.power_supported=true;fixture.battery_percent=-1;fixture.external_screen_count=0;
  strcpy(fixture.battery_status,"no-battery");strcpy(fixture.power_mode,"unknown");
  renderPower("touch-power-empty.ppm");assertLabel("未检测到电池");assertLabel("暂未提供");
  assertLabel("未连接外接屏");assertPowerButtons(true,true,false);
  fixture.bluetooth_count=0;renderPower("touch-power-bluetooth-empty.ppm");assertLabel("暂无已连接的蓝牙设备");
  fixture.bluetooth_available=false;renderPower("touch-power-bluetooth-unavailable.ppm");assertLabel("等待桌面端提供设备电量");
  strcpy(fixture.battery_status,"unknown");renderPower("touch-power-unknown.ppm");assertLabel("电量暂不可用");
  fixture.battery_percent=0;strcpy(fixture.battery_status,"charging");strcpy(fixture.power_mode,"balanced");
  renderPower("touch-power-zero.ppm");assertLabel("0%");assertLabel("正在充电");assertLabel("均衡模式");
  // Returning remains usable immediately after scrolling, with small drift
  // beyond the visible button. Keep the contact captured until release.
  pointerAt(438,39,true);pointerAt(479,39,true);pointerAt(479,39,false);assert(!PowerView::active());
  assert(!power_view_active);
  commands.clear();advance(120);
  for (int value : {0, 100}) {
    fixture.brightness = fixture.volume = value; ++fixture.revision; refresh(); advance(120);
    assert(lv_slider_get_value(brightness_slider) == value);
    capture(value ? "touch-home-full.ppm" : "touch-home-zero.ppm");
  }
  fixture.brightness = 72; fixture.volume = 64; ++fixture.revision; refresh();
  showBacklightPanel(); advance(210); capture("touch-backlight.ppm");
  lv_slider_set_value(backlight_slider, 5, LV_ANIM_OFF);
  lv_event_send(backlight_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  assert(applied_backlight == 13);
  lv_slider_set_value(backlight_slider, 100, LV_ANIM_OFF);
  lv_event_send(backlight_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  assert(applied_backlight == 255); assertBounds(backlight_value);
  closeBacklightPanel(nullptr); advance(40); showBacklightPanel(); advance(210);
  assert(!lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN));
  hideBacklightPanel(); assert(lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN));
  showMusicView(nullptr); animateAdjustmentPanel(music_volume_panel, true);
  for (int index = 0; index < 9; ++index) {
    char name[64]; snprintf(name, sizeof(name), "motion-volume-%02d.ppm", index);
    capture(name); advance(33);
  }
  assertBounds(music_volume_value); capture("touch-music-volume.ppm");
  commands.clear();
  lv_event_send(music_volume_slider, LV_EVENT_PRESSED, nullptr);
  lv_slider_set_value(music_volume_slider, 37, LV_ANIM_OFF);
  lv_event_send(music_volume_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  assert(lv_slider_get_value(volume_slider) == 37);
  assert(!strcmp(lv_label_get_text(music_volume_value), "37%"));
  assert(commands.size() == 1 && commands.back().control == "volume" && !commands.back().final_value);
  // A pending desktop value must not pull the knob away during a drag.
  fixture.volume = 64; ++fixture.revision; refresh();
  assert(lv_slider_get_value(music_volume_slider) == 37);
  lv_event_send(music_volume_slider, LV_EVENT_RELEASED, nullptr);
  assert(commands.size() == 2 && commands.back().value == 37 && commands.back().final_value);
  fixture.volume = 37; ++fixture.revision; refresh(); advance(150);
  for (int value : {0, 100}) {
    fixture.volume = value; ++fixture.revision; refresh(); advance(120);
    assertBounds(music_volume_value);
    capture(value ? "touch-music-volume-full.ppm" : "touch-music-volume-zero.ppm");
  }
  // Both music layouts share the same panel; exiting cancels its motion.
  showImmersiveLyrics(nullptr); animateAdjustmentPanel(music_volume_panel, true);
  advance(210); capture("touch-immersive-volume.ppm");
  hideMusicVolume(); assert(lv_obj_has_flag(music_volume_panel, LV_OBJ_FLAG_HIDDEN));
  animateAdjustmentPanel(music_volume_panel, true); advance(60); hideMusicView(nullptr); advance(300);
  assert(lv_obj_has_flag(music_volume_panel, LV_OBJ_FLAG_HIDDEN));
  assert(lv_obj_get_style_translate_y(music_volume_panel, 0) == 0);
  // Brightness preview and final commit retain their existing timing behavior.
  commands.clear(); lv_event_send(brightness_slider, LV_EVENT_PRESSED, nullptr);
  lv_slider_set_value(brightness_slider, 81, LV_ANIM_OFF);
  lv_event_send(brightness_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  lv_event_send(brightness_slider, LV_EVENT_RELEASED, nullptr);
  assert(commands.size() == 2 && commands.back().control == "brightness" && commands.back().value == 81 && commands.back().final_value);
  assert(checked_reuse_frames > 0);
  printf("Incremental scroll frames matched full LVGL snapshots: %u\n", checked_reuse_frames);
  puts("Actual LVGL controls preview passed: immediate input selection, rapid retargeting, duplicate suppression, failure rollback, swipe cancellation, Chinese power states, unchanged-page redraw suppression, enlarged return target, scrolling, Bluetooth devices, navigation, backlight, volume and final commits.");
}
''', encoding="utf-8")

main_source = (root / 'firmware/src/main.cpp').read_text(encoding='utf-8')
globals_source = main_source[main_source.index('uint32_t ui_copy_us'):main_source.index('bool provisioning')]
callbacks_source = main_source[main_source.index('void displayRenderStart('):main_source.index('void logMemory(')]
preview_source = (build / 'preview.cpp').read_text(encoding='utf-8')
preview_source = preview_source.replace('// PRODUCTION_PRESENTATION_GLOBALS', globals_source).replace('// PRODUCTION_PRESENTATION_CALLBACKS', callbacks_source)
(build / 'preview.cpp').write_text(preview_source, encoding='utf-8')

flags = ["-O1", "-DLV_USE_SNAPSHOT=1", "-DLV_CONF_SKIP", "-DLV_COLOR_DEPTH=16", "-DLV_COLOR_16_SWAP=0", "-DLV_MEM_CUSTOM=1", "-DLV_FONT_FMT_TXT_LARGE=1", "-DLV_USE_FONT_COMPRESSED=1"]
flags += [f"-DLV_FONT_MONTSERRAT_{size}=1" for size in [14, 16, 18, 22, 28, 36, 48]]
flags += ["-I", str(lvgl), "-I", str(build), "-I", str(root / "firmware/src")]
base = list((lvgl / "src").rglob("*.c"))
base += [root / "firmware/src/ui/assets" / name for name in [
    "azoria_font_zh_16.c", "azoria_font_zh_28.c", "azoria_font_latin_16.c", "azoria_font_latin_28.c", "azoria_font_din_condensed_48.c", "azoria_font_usage_80.c", "azoria_font_usage_110.c"]]
extra = [root / "firmware/src/ui/assets" / name for name in ["azoria_font_din_condensed_16.c", "azoria_font_music_38.c", "icons.c"]]
extra += [root / "firmware/src/ui/image.cpp", root / "firmware/src/ui/display_badge.cpp", root / "firmware/src/features/display_control/usage_view.cpp", root / "firmware/src/features/display_control/computer_view.cpp", root / "firmware/src/features/display_control/power_view.cpp", build / "preview.cpp"]

def compile_one(pair):
    index, source = pair
    if index < len(base) and source.name != "lv_snapshot.c":
        cached = root / "out/touch-usage-preview" / f"part-{index}.o"
        if cached.exists() and cached.stat().st_mtime >= source.stat().st_mtime:
            return str(cached)
    key = hashlib.sha256(str(source).encode()).hexdigest()[:12]
    target = build / f"{key}.o"
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime or source.suffix == ".cpp" or source.name == "lv_snapshot.c":
        command = [cxx if source.suffix == ".cpp" else gcc] + flags
        if source.suffix == ".cpp": command += ["-std=c++17"]
        result = subprocess.run(command + ["-c", str(source), "-o", str(target)], capture_output=True, text=True)
        if result.returncode: raise RuntimeError(result.stderr)
    return str(target)

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    objects = list(pool.map(compile_one, enumerate(base + extra)))
(build / "objects.rsp").write_text("\n".join('"' + name.replace("\\", "/") + '"' for name in objects), encoding="utf-8")
executable = build / ("preview.exe" if os.name == "nt" else "preview")
subprocess.run([cxx, "@" + str(build / "objects.rsp"), "-o", str(executable), "-lm"], check=True)
subprocess.run([str(executable)], cwd=build, check=True)
for ppm in build.glob("*.ppm"):
    with Image.open(ppm) as image: image.save(ppm.with_suffix(".png"))
overview = Image.new("RGB", (1440, 480))
for index, name in enumerate(["touch-home", "touch-backlight", "touch-music-volume"]):
    with Image.open(build / f"{name}.png") as image: overview.paste(image, (index * 480, 0))
overview.save(build / "touch-controls-overview.png")
frames = [Image.open(png).convert("RGB") for png in sorted(build.glob("motion-volume-*.png"))]
frames[0].save(build / "motion-volume.gif", save_all=True, append_images=frames[1:], duration=[33] * (len(frames) - 1) + [1000], loop=0)
print(f"Actual 480x480 LVGL previews: {build}")
