#include "features/display_control/power_view.h"
#include "features/display_control/screen.h"
#include "ui/assets/app_fonts.h"

namespace DisplayControl::PowerView {
namespace {
constexpr uint32_t kBackground = 0x0B0C10;
constexpr uint32_t kCard = 0x15171D;
constexpr uint32_t kBorder = 0x292C34;
constexpr uint32_t kText = 0xF6F1E9;
constexpr uint32_t kMuted = 0x9A9DA8;
constexpr uint32_t kAccent = 0x20DFE5;
constexpr uint32_t kGreen = 0x35D07F;
constexpr uint32_t kAmber = 0xFFC166;

uint32_t visual_revision = 0;

lv_obj_t *view, *status, *status_dot, *battery, *battery_state, *battery_bar;
lv_obj_t *mode, *screens, *off_button, *on_button, *link_button, *link_track, *link_knob, *timer_text;
lv_obj_t *content, *bluetooth_name, *bluetooth_level, *bluetooth_bar, *bluetooth_page, *previous_device, *next_device;

lv_obj_t *text(lv_obj_t *parent, const char *content, int x, int y,
               const lv_font_t *font = &azoria_font_zh_16, uint32_t ink = kText) {
  lv_obj_t *object = lv_label_create(parent);
  lv_label_set_text(object, content);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_style_text_font(object, font, 0);
  lv_obj_set_style_text_color(object, lv_color_hex(ink), 0);
  return object;
}

lv_obj_t *box(lv_obj_t *parent, int x, int y, int width, int height,
              uint32_t ink, int radius) {
  lv_obj_t *object = lv_obj_create(parent);
  lv_obj_remove_style_all(object);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_size(object, width, height);
  lv_obj_set_style_bg_color(object, lv_color_hex(ink), 0);
  lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(object, radius, 0);
  lv_obj_clear_flag(object, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
  return object;
}

void outline(lv_obj_t *object) {
  lv_obj_set_style_border_color(object, lv_color_hex(kBorder), 0);
  lv_obj_set_style_border_width(object, 1, 0);
}

void buttonVisualChanged(lv_event_t *event) {
  switch (lv_event_get_code(event)) {
    case LV_EVENT_PRESSED:
    case LV_EVENT_RELEASED:
    case LV_EVENT_PRESS_LOST:
      ++visual_revision; break;
    default: break;
  }
}

lv_obj_t *button(lv_obj_t *parent, int x, int y, int width, int height,
                 uint32_t ink) {
  lv_obj_t *object = lv_btn_create(parent);
  lv_obj_remove_style_all(object);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_size(object, width, height);
  lv_obj_set_style_bg_color(object, lv_color_hex(ink), 0);
  lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(object, 12, 0);
  lv_obj_set_style_bg_color(object, lv_color_hex(ink == kText ? 0xC8CDD2 : 0x292E38), LV_STATE_PRESSED);
  lv_obj_set_style_opa(object, LV_OPA_40, LV_STATE_DISABLED);
  lv_obj_clear_flag(object, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_add_event_cb(object, buttonVisualChanged, LV_EVENT_ALL, nullptr);
  return object;
}

void disabled(lv_obj_t *object, bool value) {
  if (lv_obj_has_state(object, LV_STATE_DISABLED) == value) return;
  ++visual_revision;
  if (value) lv_obj_add_state(object, LV_STATE_DISABLED);
  else lv_obj_clear_state(object, LV_STATE_DISABLED);
}

// LVGL invalidates even when text/styles are set to their current values.
// This page is polled from the UI loop; leave unchanged widgets untouched so
// input and scroll drawing do not compete with continuous status redraws.
void setText(lv_obj_t *object, const char *value) {
  if (strcmp(lv_label_get_text(object), value)) {
    ++visual_revision; lv_label_set_text(object, value);
  }
}

void setBackground(lv_obj_t *object, lv_color_t value) {
  if (lv_obj_get_style_bg_color(object, 0).full != value.full)
    { ++visual_revision; lv_obj_set_style_bg_color(object, value, 0); }
}

void setInk(lv_obj_t *object, lv_color_t value) {
  if (lv_obj_get_style_text_color(object, 0).full != value.full)
    { ++visual_revision; lv_obj_set_style_text_color(object, value, 0); }
}

void setWidth(lv_obj_t *object, int value) {
  if (lv_obj_get_style_width(object, 0) != value) {
    ++visual_revision; lv_obj_set_width(object, value);
  }
}

void setHidden(lv_obj_t *object, bool hidden) {
  if (lv_obj_has_flag(object, LV_OBJ_FLAG_HIDDEN) == hidden) return;
  ++visual_revision;
  if (hidden) lv_obj_add_flag(object, LV_OBJ_FLAG_HIDDEN);
  else lv_obj_clear_flag(object, LV_OBJ_FLAG_HIDDEN);
}

void diagnosticScroll(void *object, int32_t y) {
  lv_obj_scroll_to_y(static_cast<lv_obj_t *>(object), y, LV_ANIM_OFF);
}

void back(lv_event_t *) { hide(); }

void command(lv_event_t *event) {
  const char *action = static_cast<const char *>(lv_event_get_user_data(event));
  noteInteraction();
  queuePowerControl(action);
  refresh(getRemoteState());
}

void toggleLink(lv_event_t *) {
  const RemoteState state = getRemoteState();
  noteInteraction();
  queuePowerControl(state.external_power_linked ? "link-off" : "link-on");
  refresh(getRemoteState());
}

void changeDevice(lv_event_t *event) {
  const RemoteState state = getRemoteState();
  const int index = state.bluetooth_index + (lv_event_get_target(event) == next_device ? 1 : -1);
  if (state.bluetooth_pending || index < 0 || index >= state.bluetooth_count) return;
  noteInteraction();
  selectBluetoothDevice(index);
  refresh(getRemoteState());
}

const char *batteryName(const char *value) {
  if (!strcmp(value, "charging")) return "正在充电";
  if (!strcmp(value, "discharging")) return "使用电池";
  if (!strcmp(value, "full")) return "已充满";
  if (!strcmp(value, "no-battery")) return "未检测到电池";
  return "电量暂不可用";
}

const char *modeName(const char *value) {
  if (!strcmp(value, "performance")) return "性能模式";
  if (!strcmp(value, "balanced")) return "均衡模式";
  if (!strcmp(value, "power-saver")) return "节电模式";
  return "暂未提供";
}
}  // namespace

void create(lv_obj_t *parent) {
  view = box(parent, 0, 0, 480, 480, kBackground, 0);
  lv_obj_add_flag(view, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_clear_flag(view, LV_OBJ_FLAG_GESTURE_BUBBLE);
  text(view, "电源管理", 20, 17, &azoria_font_zh_28);
  status_dot = box(view, 21, 63, 6, 6, kMuted, LV_RADIUS_CIRCLE);
  status = text(view, "等待桌面端连接", 35, 55, &azoria_font_zh_16, kMuted);
  text(view, "上滑查看更多", 300, 55, &azoria_font_zh_16, kMuted);
  lv_obj_t *back_button = button(view, 416, 17, 44, 44, kCard);
  outline(back_button);
  // Keep the visual size but use the free header space for a forgiving hit
  // target. Retain the contact if a finger drifts outside before release.
  lv_obj_set_ext_click_area(back_button, 16);
  lv_obj_add_flag(back_button, LV_OBJ_FLAG_PRESS_LOCK);
  lv_obj_add_event_cb(back_button, back, LV_EVENT_CLICKED, nullptr);
  lv_obj_center(text(back_button, LV_SYMBOL_LEFT, 0, 0, &lv_font_montserrat_18));

  content = box(view, 0, 82, 480, 398, kBackground, 0);
  lv_obj_add_flag(content, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
  lv_obj_clear_flag(content, LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_set_scroll_dir(content, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(content, LV_SCROLLBAR_MODE_OFF);
  lv_obj_set_style_pad_bottom(content, 20, 0);
  lv_obj_set_style_bg_color(content, lv_color_hex(kBorder), LV_PART_SCROLLBAR);
  lv_obj_set_style_width(content, 3, LV_PART_SCROLLBAR);

  lv_obj_t *external = box(content, 20, 8, 440, 150, kCard, 16);
  outline(external);
  // A small monitor outline keeps the section recognizable without a new asset.
  lv_obj_t *monitor = box(external, 17, 18, 20, 14, kCard, 3);
  lv_obj_set_style_border_color(monitor, lv_color_hex(kText), 0);
  lv_obj_set_style_border_width(monitor, 2, 0);
  box(external, 25, 32, 4, 3, kText, 0);
  box(external, 22, 35, 10, 2, kText, 1);
  text(external, "外接屏电源", 46, 16);
  screens = text(external, "等待同步", 214, 16, &azoria_font_zh_16, kAccent);
  lv_obj_set_width(screens, 210);
  lv_obj_set_style_text_align(screens, LV_TEXT_ALIGN_RIGHT, 0);
  text(external, "保留笔记本内屏，恢复原有显示布局", 16, 49, &azoria_font_zh_16, kMuted);
  off_button = button(external, 16, 76, 198, 54, kText);
  lv_obj_center(text(off_button, "熄灭外接屏", 0, 0, &azoria_font_zh_16, kBackground));
  lv_obj_add_event_cb(off_button, command, LV_EVENT_CLICKED, const_cast<char *>("off"));
  on_button = button(external, 226, 76, 198, 54, kCard);
  lv_obj_set_style_opa(on_button, LV_OPA_60, LV_STATE_DISABLED);
  outline(on_button);
  lv_obj_center(text(on_button, "恢复外接屏", 0, 0));
  lv_obj_add_event_cb(on_button, command, LV_EVENT_CLICKED, const_cast<char *>("on"));

  lv_obj_t *computer = box(content, 20, 170, 440, 92, kCard, 16);
  outline(computer);
  text(computer, "电脑电池", 16, 11, &azoria_font_zh_16, kMuted);
  battery = text(computer, "--", 16, 36, &lv_font_montserrat_28);
  battery_state = text(computer, "等待同步", 112, 45, &azoria_font_zh_16, kMuted);
  lv_obj_t *track = box(computer, 16, 76, 252, 4, kBorder, 2);
  battery_bar = box(track, 0, 0, 252, 4, kGreen, 2);
  box(computer, 284, 16, 1, 60, kBorder, 0);
  text(computer, "电源模式", 304, 17, &azoria_font_zh_16, kMuted);
  mode = text(computer, "等待同步", 304, 47, &azoria_font_zh_16, kAccent);

  lv_obj_t *bluetooth = box(content, 20, 274, 440, 110, kCard, 16);
  outline(bluetooth);
  text(bluetooth, LV_SYMBOL_BLUETOOTH, 16, 16, &lv_font_montserrat_18, kAccent);
  text(bluetooth, "蓝牙设备电量", 38, 14);
  bluetooth_page = text(bluetooth, "--", 248, 16, &azoria_font_zh_16, kMuted);
  lv_obj_set_width(bluetooth_page, 68);
  lv_obj_set_style_text_align(bluetooth_page, LV_TEXT_ALIGN_RIGHT, 0);
  previous_device = button(bluetooth, 328, 6, 44, 40, kCard);
  next_device = button(bluetooth, 380, 6, 44, 40, kCard);
  lv_obj_center(text(previous_device, LV_SYMBOL_LEFT, 0, 0, &lv_font_montserrat_16));
  lv_obj_center(text(next_device, LV_SYMBOL_RIGHT, 0, 0, &lv_font_montserrat_16));
  lv_obj_add_event_cb(previous_device, changeDevice, LV_EVENT_CLICKED, nullptr);
  lv_obj_add_event_cb(next_device, changeDevice, LV_EVENT_CLICKED, nullptr);
  bluetooth_name = text(bluetooth, "等待桌面端同步", 16, 52);
  lv_obj_set_width(bluetooth_name, 296);
  lv_label_set_long_mode(bluetooth_name, LV_LABEL_LONG_DOT);
  bluetooth_level = text(bluetooth, "--", 328, 49, &azoria_font_zh_16, kMuted);
  lv_obj_set_width(bluetooth_level, 96);
  lv_obj_set_style_text_align(bluetooth_level, LV_TEXT_ALIGN_RIGHT, 0);
  lv_obj_t *bluetooth_track = box(bluetooth, 16, 88, 408, 4, kBorder, 2);
  bluetooth_bar = box(bluetooth_track, 0, 0, 408, 4, kAccent, 2);

  // The entire row is the touch target; the switch mirrors confirmed desktop state.
  link_button = button(content, 20, 396, 440, 88, kCard);
  lv_obj_set_style_opa(link_button, LV_OPA_COVER, LV_STATE_DISABLED);
  outline(link_button);
  text(link_button, "与 Touch 定时息屏联动", 16, 14);
  link_track = box(link_button, 368, 12, 56, 30, kBorder, LV_RADIUS_CIRCLE);
  link_knob = box(link_track, 4, 4, 22, 22, kText, LV_RADIUS_CIRCLE);
  lv_obj_add_event_cb(link_button, toggleLink, LV_EVENT_CLICKED, nullptr);
  timer_text = text(link_button, "请在桌面端开启定时息屏", 16, 52, &azoria_font_zh_16, kMuted);
  lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN);
}

void show() {
  if (!view) return;
  setPowerViewActive(true);
  noteInteraction();
  lv_obj_clear_flag(view, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(view);
  lv_obj_scroll_to_y(content, 0, LV_ANIM_OFF);
  refresh(getRemoteState());
}

void hide() {
  if (content) lv_anim_del(content, diagnosticScroll);
  setPowerViewActive(false);
  if (view) lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN);
  noteInteraction();
}

void runScrollDiagnostics() {
  if (!active()) show();
  lv_obj_update_layout(content);
  lv_obj_scroll_to_y(content, 0, LV_ANIM_OFF);
  lv_anim_del(content, diagnosticScroll);
  lv_anim_t animation;
  lv_anim_init(&animation);
  lv_anim_set_var(&animation, content);
  lv_anim_set_exec_cb(&animation, diagnosticScroll);
  lv_anim_set_values(&animation, 0, lv_obj_get_scroll_bottom(content));
  lv_anim_set_time(&animation, 800);
  lv_anim_set_playback_time(&animation, 800);
  lv_anim_set_repeat_count(&animation, 2);
  lv_anim_start(&animation);
}

bool active() { return view && !lv_obj_has_flag(view, LV_OBJ_FLAG_HIDDEN); }

bool scrollDiagnosticsActive() { return content && lv_anim_get(content, diagnosticScroll); }

int16_t scrollOffset() { return content ? lv_obj_get_scroll_y(content) : 0; }
uint32_t visualRevision() { return visual_revision; }

void refresh(const RemoteState &state) {
  if (!active()) return;
  // Keep the scroll surface stable during a drag/inertia. Latest desktop data
  // is applied immediately after motion ends; control presses still refresh.
  if (lv_obj_is_scrolling(content) || lv_anim_get(content, diagnosticScroll)) return;
  const bool available = state.online && state.power_supported;
  const bool busy = state.power_pending || state.power_busy;
  const bool blocked = !available || busy;
  const uint32_t status_ink = !available ? kMuted : busy ? kAmber : kGreen;
  setText(status, !state.online ? "等待桌面端连接" :
                    !state.power_supported ? "外接屏控制暂不可用" :
                    busy ? "正在应用设置" : "已连接桌面端 · 实时同步");
  setBackground(status_dot, lv_color_hex(status_ink));
  setInk(status, lv_color_hex(status_ink));

  char buffer[100];
  const bool data_available = state.online && state.power_data_available;
  const bool has_battery = data_available && state.battery_percent >= 0 &&
                           strcmp(state.battery_status, "no-battery");
  const int level = has_battery ? std::min<int>(state.battery_percent, 100) : 0;
  snprintf(buffer, sizeof(buffer), "%d%%", level);
  setText(battery, has_battery ? buffer : "--");
  setText(battery_state, data_available ? batteryName(state.battery_status) : "等待同步");
  setWidth(battery_bar, level * 252 / 100);
  setHidden(battery_bar, level == 0);
  setBackground(battery_bar, lv_color_hex(level <= 20 ? kAmber : kGreen));
  setText(mode, data_available ? modeName(state.power_mode) : "等待同步");

  const bool bluetooth_available = state.online && state.bluetooth_available;
  const bool has_device = bluetooth_available && state.bluetooth_count > 0;
  const bool has_level = has_device && state.bluetooth_percent >= 0;
  setText(bluetooth_name, !state.online ? "连接桌面端后同步设备电量" :
                    !bluetooth_available ? "等待桌面端提供设备电量" :
                    !has_device ? "暂无已连接的蓝牙设备" :
                    state.bluetooth_pending ? "正在读取设备电量" : state.bluetooth_name);
  snprintf(buffer, sizeof(buffer), "%d%%", state.bluetooth_percent);
  setText(bluetooth_level, !has_device || state.bluetooth_pending ? "--" : has_level ? buffer : "未提供电量");
  snprintf(buffer, sizeof(buffer), "%u / %u", state.bluetooth_index + 1, state.bluetooth_count);
  setText(bluetooth_page, has_device ? buffer : "--");
  const int device_level = has_level && !state.bluetooth_pending ? std::min<int>(state.bluetooth_percent, 100) : 0;
  setWidth(bluetooth_bar, device_level * 408 / 100);
  setHidden(bluetooth_bar, device_level == 0);
  setBackground(bluetooth_bar, lv_color_hex(device_level <= 20 ? kAmber : kAccent));
  disabled(previous_device, !has_device || state.bluetooth_pending || state.bluetooth_index == 0);
  disabled(next_device, !has_device || state.bluetooth_pending || state.bluetooth_index + 1 >= state.bluetooth_count);

  snprintf(buffer, sizeof(buffer), "%u 块 · %s", state.external_screen_count,
           state.external_screens_off ? "已熄灭" : "正常显示");
  setText(screens, !available ? "等待同步" : state.external_screen_count == 0 ? "未连接外接屏" : buffer);
  setInk(screens, lv_color_hex(!available || state.external_screen_count == 0 ? kMuted :
                               state.external_screens_off ? kAmber : kAccent));
  disabled(off_button, blocked || state.external_screens_off || state.external_screen_count == 0);
  disabled(on_button, blocked || !state.external_screens_off);
  disabled(link_button, blocked);
  const lv_opa_t link_opacity = blocked ? LV_OPA_40 : LV_OPA_COVER;
  if (lv_obj_get_style_opa(link_track, 0) != link_opacity) {
    ++visual_revision; lv_obj_set_style_opa(link_track, link_opacity, 0);
  }
  setBackground(link_track, lv_color_hex(state.external_power_linked ? kAccent : kBorder));
  setBackground(link_knob, lv_color_hex(state.external_power_linked ? kBackground : kText));
  const int knob_x = state.external_power_linked ? 30 : 4;
  if (lv_obj_get_style_x(link_knob, 0) != knob_x) {
    ++visual_revision; lv_obj_set_x(link_knob, knob_x);
  }

  snprintf(buffer, sizeof(buffer), "%02u:%02u - %02u:%02u · %s",
           state.touch_sleep_start_minutes / 60, state.touch_sleep_start_minutes % 60,
           state.touch_sleep_end_minutes / 60, state.touch_sleep_end_minutes % 60,
           state.external_power_linked ? "到时自动熄灭 / 恢复" : "联动未开启");
  setText(timer_text, !available ? "连接桌面端后同步息屏设置" :
                    state.touch_sleep_enabled ? buffer : "请在桌面端开启定时息屏");
}
}  // namespace DisplayControl::PowerView
