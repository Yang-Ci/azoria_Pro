#include "features/display_control/screen.h"

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <lvgl.h>
#include <time.h>

#include "features/display_control/service.h"
#include "features/wallpaper/wallpaper.h"
#include "platform/board.h"
#include "ui/display_badge.h"
#include "ui/assets/app_fonts.h"
#include "ui/assets/icons.h"
#include "ui/image.h"

namespace DisplayControl {
namespace {

lv_color_t color(uint32_t value) {
  return lv_color_hex(value);
}

lv_obj_t *controls = nullptr;
lv_obj_t *status_dot = nullptr;
lv_obj_t *brightness_slider = nullptr;
lv_obj_t *brightness_value = nullptr;
lv_obj_t *volume_slider = nullptr;
lv_obj_t *volume_value = nullptr;
lv_obj_t *mute_button = nullptr;
lv_obj_t *mute_icon = nullptr;
lv_obj_t *clock_label = nullptr;
lv_obj_t *weekday_label = nullptr;
lv_obj_t *date_label = nullptr;
lv_obj_t *brightness_segments[40]{};
constexpr int kInputCount = 5;
constexpr int kInputOrder[kInputCount] = {3, 1, 2, 0, 4};
lv_obj_t *input_strip = nullptr;
lv_obj_t *input_buttons[kInputCount]{};
lv_obj_t *input_icons[kInputCount]{};
lv_obj_t *footer_text = nullptr;
lv_obj_t *backlight_panel = nullptr;
lv_obj_t *backlight_slider = nullptr;
lv_obj_t *backlight_value = nullptr;
uint32_t shown_revision = UINT32_MAX;
bool local_muted = false;
bool brightness_dragging = false;
bool volume_dragging = false;
uint32_t brightness_last_sent = 0;
uint32_t volume_last_sent = 0;
uint32_t post_interaction_redraw_due = 0;
uint32_t next_clock_update = 0;
uint16_t active_input = 3;
int16_t pending_input = -1;
int16_t pressed_input = -1;
lv_point_t input_press_point{};
uint32_t input_click_block_until = 0;
bool controls_enabled = false;
int current_backlight_percent = 86;
uint32_t last_interaction_at = 0;
bool wallpaper_exit_requested = false;
lv_obj_t *music_view = nullptr;
lv_obj_t *music_title = nullptr;
lv_obj_t *music_artist = nullptr;
lv_obj_t *music_status = nullptr;
lv_obj_t *music_play_label = nullptr;
lv_obj_t *music_mode_label = nullptr;
lv_obj_t *music_lyric_previous = nullptr;
lv_obj_t *music_lyric_current = nullptr;
lv_obj_t *music_lyric_next = nullptr;
lv_obj_t *music_progress_bar = nullptr;
lv_obj_t *music_elapsed_label = nullptr;
lv_obj_t *music_duration_label = nullptr;
lv_obj_t *music_buttons[4]{};
bool music_view_active = false;
uint16_t wallpaper_idle_minutes = 5;

constexpr char kBacklightNamespace[] = "azoria.ui";
constexpr char kBacklightKey[] = "screen";
constexpr int kDefaultBacklightPercent = 86;
constexpr int kMinBacklightPercent = 5;
constexpr char kWallpaperIdleKey[] = "wall_idle";
constexpr uint16_t kDefaultWallpaperIdleMinutes = 5;

// LG USB VCP needs roughly 300 ms per preview on this monitor. Producing updates
// faster only keeps Wi-Fi/HTTP continuously busy; the local slider remains
// immediate and release still queues the final value without delay.
constexpr uint32_t kDragSendIntervalMs = 400;
constexpr uint32_t kPostInteractionRedrawDelayMs = 2000;
constexpr int kBrightnessSegmentCount = 40;
constexpr const char *kInputValues[] = {
    "dp1", "hdmi1", "hdmi2", "usbc", "internal",
};
constexpr const char *kInputLabels[] = {
    "DP", "HDMI 1", "HDMI 2", "USB-C", "PANEL",
};
constexpr int kInputButtonWidth = 108;
constexpr int kInputButtonHeight = 98;
constexpr int kInputStride = 116;
constexpr int kInputStripWidth = 458;
constexpr int kInputStripHeight = 109;
constexpr int kInputTapSlop = 10;
constexpr uint32_t kInputClickBlockMs = 250;
constexpr int kPanelPageScrollX =
    kInputStride * (kInputCount - 1) + kInputButtonWidth - kInputStripWidth;

int loadBacklightSetting() {
  Preferences preferences;
  if (!preferences.begin(kBacklightNamespace, true)) return kDefaultBacklightPercent;
  const int value = preferences.getInt(kBacklightKey, kDefaultBacklightPercent);
  preferences.end();
  return constrain(value, kMinBacklightPercent, 100);
}

void saveBacklightSetting(int value) {
  Preferences preferences;
  preferences.begin(kBacklightNamespace, false);
  preferences.putInt(kBacklightKey, constrain(value, kMinBacklightPercent, 100));
  preferences.end();
}

bool validWallpaperIdleMinutes(uint16_t minutes) {
  return minutes == 0 || minutes == 1 || minutes == 5 ||
         minutes == 10 || minutes == 30;
}

uint16_t loadWallpaperIdleMinutes() {
  Preferences preferences;
  if (!preferences.begin(kBacklightNamespace, true)) {
    return kDefaultWallpaperIdleMinutes;
  }
  const uint16_t value = preferences.getUShort(
      kWallpaperIdleKey, kDefaultWallpaperIdleMinutes);
  preferences.end();
  return validWallpaperIdleMinutes(value) ? value
                                         : kDefaultWallpaperIdleMinutes;
}

void saveWallpaperIdleMinutes(uint16_t minutes) {
  Preferences preferences;
  if (!preferences.begin(kBacklightNamespace, false)) return;
  preferences.putUShort(kWallpaperIdleKey, minutes);
  preferences.end();
}

void applyBacklight(int value) {
  current_backlight_percent = constrain(value, kMinBacklightPercent, 100);
  const int scaled = (current_backlight_percent * 255 + 50) / 100;
  Board::setBacklight(static_cast<uint8_t>(scaled));
}

void disableScrolling(lv_obj_t *object) {
  lv_obj_clear_flag(
      object, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_SCROLL_CHAIN |
                  LV_OBJ_FLAG_SCROLL_ELASTIC | LV_OBJ_FLAG_SCROLL_MOMENTUM);
}

lv_obj_t *label(lv_obj_t *parent, const char *text, int x, int y,
                const lv_font_t *font = &lv_font_montserrat_18) {
  lv_obj_t *object = lv_label_create(parent);
  lv_label_set_text(object, text);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_style_text_font(object, font, 0);
  return object;
}

lv_obj_t *card(lv_obj_t *parent, int x, int y, int width, int height) {
  lv_obj_t *object = lv_obj_create(parent);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_size(object, width, height);
  lv_obj_set_style_bg_color(object, color(0x111827), 0);
  lv_obj_set_style_border_width(object, 0, 0);
  lv_obj_set_style_radius(object, 12, 0);
  lv_obj_set_style_pad_all(object, 0, 0);
  lv_obj_set_style_shadow_width(object, 0, 0);
  disableScrolling(object);
  return object;
}

lv_obj_t *staticLabel(lv_obj_t *parent, const char *text, int x, int y,
                      const lv_font_t *font, uint32_t text_color) {
  lv_obj_t *object = label(parent, text, x, y, font);
  lv_obj_set_style_text_color(object, color(text_color), 0);
  return object;
}

void updateClock() {
  if (!clock_label || !weekday_label || !date_label) return;
  time_t now = time(nullptr);
  struct tm local_time;
  localtime_r(&now, &local_time);
  if (local_time.tm_year < 120) {
    lv_label_set_text(clock_label, "--:--:--");
    lv_label_set_text(weekday_label, "星期--");
    lv_label_set_text(date_label, "----/--/--");
    return;
  }
  char time_text[12];
  char date_text[16];
  snprintf(time_text, sizeof(time_text), "%02d:%02d:%02d", local_time.tm_hour,
           local_time.tm_min, local_time.tm_sec);
  snprintf(date_text, sizeof(date_text), "%04d/%d/%d", local_time.tm_year + 1900,
           local_time.tm_mon + 1, local_time.tm_mday);
  static const char *weekdays[] = {"星期日", "星期一", "星期二", "星期三",
                                   "星期四", "星期五", "星期六"};
  lv_label_set_text(clock_label, time_text);
  lv_label_set_text(weekday_label, weekdays[local_time.tm_wday]);
  lv_label_set_text(date_label, date_text);
}

void updateBrightnessSegments(int value) {
  int active_count = (value * kBrightnessSegmentCount + 99) / 100;
  for (int index = 0; index < kBrightnessSegmentCount; ++index) {
    if (!brightness_segments[index]) continue;
    lv_obj_set_style_bg_color(
        brightness_segments[index],
        color(index < active_count ? 0xE1F4FF : 0x555555), 0);
  }
}

lv_obj_t *createWindowsIcon(lv_obj_t *parent, int x, int y,
                            lv_color_t icon_color) {
  lv_obj_t *root = lv_obj_create(parent);
  lv_obj_set_pos(root, x, y);
  lv_obj_set_size(root, 34, 30);
  lv_obj_set_style_bg_opa(root, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(root, 0, 0);
  lv_obj_set_style_pad_all(root, 0, 0);
  lv_obj_clear_flag(root, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  const int widths[] = {15, 15, 15, 15};
  const int heights[] = {12, 12, 12, 12};
  const int positions[][2] = {{0, 0}, {18, 0}, {0, 15}, {18, 15}};
  for (int index = 0; index < 4; ++index) {
    lv_obj_t *pane = lv_obj_create(root);
    lv_obj_set_pos(pane, positions[index][0], positions[index][1]);
    lv_obj_set_size(pane, widths[index], heights[index]);
    lv_obj_set_style_bg_color(pane, icon_color, 0);
    lv_obj_set_style_bg_opa(pane, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(pane, 0, 0);
    lv_obj_set_style_radius(pane, 1, 0);
    lv_obj_clear_flag(pane, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  }
  return root;
}

void styleSlider(lv_obj_t *slider, int width, uint32_t accent) {
  lv_obj_set_size(slider, width, 22);
  lv_obj_set_style_bg_color(slider, color(0x000000), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(slider, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_height(slider, 6, LV_PART_MAIN);
  lv_obj_set_style_radius(slider, 3, LV_PART_MAIN);
  lv_obj_set_style_bg_color(slider, color(accent), LV_PART_INDICATOR);
  lv_obj_set_style_height(slider, 6, LV_PART_INDICATOR);
  lv_obj_set_style_radius(slider, 3, LV_PART_INDICATOR);
  lv_obj_set_style_bg_color(slider, color(0xFFFFFF), LV_PART_KNOB);
  lv_obj_set_style_width(slider, 22, LV_PART_KNOB);
  lv_obj_set_style_height(slider, 22, LV_PART_KNOB);
  lv_obj_set_style_radius(slider, LV_RADIUS_CIRCLE, LV_PART_KNOB);
}

void setFooter(const char *text) {
  if (footer_text) lv_label_set_text(footer_text, text);
}

void scheduleFullRedraw() {
  post_interaction_redraw_due =
      millis() + kPostInteractionRedrawDelayMs;
}

const char *localizedMessage(const char *message) {
  if (!message) return "";
  if (strstr(message, "Saving") || strstr(message, "Saved") ||
      strstr(message, "DDC connected") ||
      strstr(message, "Input command sent") ||
      strstr(message, "Power command sent")) {
    return "";
  }
  if (strstr(message, "Desktop offline") ||
      strstr(message, "Wi-Fi offline")) return "离线";
  if (strstr(message, "Finding Mac") ||
      strstr(message, "Connecting")) return "连接中";
  if (strstr(message, "input verification failed")) return "切换失败";
  if (strstr(message, "verification failed")) return "操作失败";
  if (strstr(message, "queue full")) return "请稍后";
  return "";
}

int inputIndex(const char *value) {
  if (!value) return -1;
  for (int index = 0; index < kInputCount; ++index) {
    if (!strcmp(value, kInputValues[index])) return index;
  }
  return -1;
}

void updateInputButtons(bool pending = false) {
  for (int index = 0; index < kInputCount; ++index) {
    if (!input_buttons[index]) continue;
    bool selected = index == active_input;
    lv_color_t button_color =
        color(selected ? 0xE1F4FF : 0x1D1D1D);
    lv_obj_set_style_bg_color(input_buttons[index], button_color, 0);
    lv_obj_set_style_bg_color(input_buttons[index], button_color,
                              LV_STATE_DISABLED);
    lv_obj_set_style_bg_opa(input_buttons[index], LV_OPA_COVER,
                            LV_STATE_DISABLED);
    lv_obj_set_style_border_width(
        input_buttons[index],
        pending && index == pending_input ? 2 : 0, 0);
    lv_obj_set_style_border_width(
        input_buttons[index],
        pending && index == pending_input ? 2 : 0, LV_STATE_DISABLED);
    lv_obj_set_style_border_color(input_buttons[index],
                                  color(0xA5B4FC), 0);

    lv_obj_t *caption = lv_obj_get_child(input_buttons[index],
                                         lv_obj_get_child_cnt(input_buttons[index]) - 1);
    if (caption) {
      lv_obj_set_style_text_color(
          caption, color(selected ? 0x000000 : 0xEBF4FF), 0);
      lv_obj_set_style_text_opa(caption, LV_OPA_50, 0);
    }
    lv_obj_t *icon = input_icons[index];
    if (!icon) continue;
    // Every selected source sits on the light selected tile, so its glyph must
    // switch to the dark optical color. Windows previously stayed light and
    // nearly disappeared against its selected background.
    lv_color_t icon_color = color(selected ? 0x050505 : 0xEBF4FF);
    lv_obj_set_style_img_recolor(icon, icon_color, 0);
    lv_obj_set_style_img_recolor_opa(icon, LV_OPA_COVER, 0);
    lv_obj_set_style_opa(icon, LV_OPA_COVER, LV_STATE_DISABLED);
  }
}

void updateMuteVisual() {
  if (!mute_button || !mute_icon) return;
  const bool muted = local_muted;
  const lv_color_t background = color(muted ? 0x3A1E2B : 0x1D1D1D);
  const lv_color_t foreground = color(muted ? 0xF04438 : 0xEBF4FF);
  lv_obj_set_style_bg_color(mute_button, background, 0);
  lv_obj_set_style_bg_color(mute_button, background, LV_STATE_DISABLED);
  lv_obj_set_style_bg_opa(mute_button, LV_OPA_COVER, LV_STATE_DISABLED);
  lv_obj_set_style_border_width(mute_button, muted ? 1 : 0, 0);
  lv_obj_set_style_border_width(mute_button, muted ? 1 : 0, LV_STATE_DISABLED);
  lv_obj_set_style_border_color(mute_button, color(0xF04438), 0);
  lv_obj_set_style_border_color(mute_button, color(0xF04438), LV_STATE_DISABLED);
  lv_obj_set_style_img_recolor(mute_icon, foreground, 0);
  lv_obj_set_style_img_recolor_opa(mute_icon, LV_OPA_COVER, 0);
}

void brightnessPressed(lv_event_t *) {
  brightness_dragging = true;
  post_interaction_redraw_due = 0;
}

void brightnessChanged(lv_event_t *) {
  int value = lv_slider_get_value(brightness_slider);
  lv_label_set_text_fmt(brightness_value, "%d%%", value);
  updateBrightnessSegments(value);
  if (brightness_dragging &&
      millis() - brightness_last_sent >= kDragSendIntervalMs) {
    if (!queueNumericControl("brightness", value, false)) {
      setFooter("亮度失败");
    }
    brightness_last_sent = millis();
  }
}

void brightnessReleased(lv_event_t *) {
  if (!brightness_dragging) return;
  brightness_dragging = false;
  int value = lv_slider_get_value(brightness_slider);
  if (!queueNumericControl("brightness", value, true)) {
    setFooter("亮度失败");
  }
  brightness_last_sent = millis();
  scheduleFullRedraw();
}

void volumePressed(lv_event_t *) {
  volume_dragging = true;
  post_interaction_redraw_due = 0;
}

void volumeChanged(lv_event_t *) {
  int value = lv_slider_get_value(volume_slider);
  if (volume_value) lv_label_set_text_fmt(volume_value, "%d", value);
  if (volume_dragging &&
      millis() - volume_last_sent >= kDragSendIntervalMs) {
    if (!queueNumericControl("volume", value, false)) {
      setFooter("音量失败");
    }
    volume_last_sent = millis();
  }
}

void volumeReleased(lv_event_t *) {
  if (!volume_dragging) return;
  volume_dragging = false;
  int value = lv_slider_get_value(volume_slider);
  if (!queueNumericControl("volume", value, true)) {
    setFooter("音量失败");
  }
  volume_last_sent = millis();
  scheduleFullRedraw();
}

void muteClicked(lv_event_t *) {
  bool requested = !local_muted;
  if (!queueBooleanControl("mute", requested)) {
    setFooter("静音失败");
    return;
  }
  local_muted = requested;
  updateMuteVisual();
  setFooter("");
  scheduleFullRedraw();
}

void inputPressed(lv_event_t *event) {
  pressed_input = static_cast<int16_t>(
      reinterpret_cast<intptr_t>(lv_event_get_user_data(event)));
  lv_indev_t *input = lv_indev_get_act();
  if (input) lv_indev_get_point(input, &input_press_point);
}

void inputClicked(lv_event_t *event) {
  int index = static_cast<int>(
      reinterpret_cast<intptr_t>(lv_event_get_user_data(event)));
  lv_indev_t *input = lv_indev_get_act();
  lv_point_t release_point = input_press_point;
  if (input) lv_indev_get_point(input, &release_point);
  const bool dragged = abs(release_point.x - input_press_point.x) > kInputTapSlop ||
                       abs(release_point.y - input_press_point.y) > kInputTapSlop;
  const bool click_blocked =
      static_cast<int32_t>(input_click_block_until - millis()) > 0;
  if (index != pressed_input || dragged || click_blocked) {
    pressed_input = -1;
    return;
  }
  pressed_input = -1;
  if (index < 0 || index >= kInputCount || index == active_input) return;
  if (brightness_dragging || volume_dragging) return;
  if (!queueStringControl("input", kInputValues[index])) {
    setFooter("切换失败");
    return;
  }
  pending_input = static_cast<int16_t>(index);
  updateInputButtons(true);
  setFooter("");
  Serial.printf("INPUT_COMMIT,INDEX=%d,VALUE=%s\n",
                index, kInputValues[index]);
  scheduleFullRedraw();
}

void inputGesture(lv_event_t *) {
  lv_indev_t *input = lv_indev_get_act();
  if (!input || !input_strip) return;
  const lv_dir_t direction = lv_indev_get_gesture_dir(input);
  if (direction == LV_DIR_LEFT) {
    lv_obj_scroll_to_x(input_strip, kPanelPageScrollX, LV_ANIM_ON);
  } else if (direction == LV_DIR_RIGHT) {
    lv_obj_scroll_to_x(input_strip, 0, LV_ANIM_ON);
  } else {
    return;
  }
  input_click_block_until = millis() + kInputClickBlockMs;
  pressed_input = -1;
  lv_indev_wait_release(input);
  scheduleFullRedraw();
}

void inputStripScrolled(lv_event_t *) {
  input_click_block_until = millis() + kInputClickBlockMs;
  pressed_input = -1;
}

void showBacklightPanel() {
  if (!backlight_panel) return;
  lv_obj_clear_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(backlight_panel);
  scheduleFullRedraw();
}

void hideBacklightPanel() {
  if (!backlight_panel) return;
  lv_obj_add_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN);
  scheduleFullRedraw();
}

void backlightChanged(lv_event_t *) {
  if (!backlight_slider || !backlight_value) return;
  const int value = lv_slider_get_value(backlight_slider);
  applyBacklight(value);
  lv_label_set_text_fmt(backlight_value, "%d%%", current_backlight_percent);
}

void backlightReleased(lv_event_t *) {
  if (!backlight_slider) return;
  saveBacklightSetting(lv_slider_get_value(backlight_slider));
  scheduleFullRedraw();
}

void closeBacklightPanel(lv_event_t *) {
  hideBacklightPanel();
}

void screenGesture(lv_event_t *) {
  lv_indev_t *input = lv_indev_get_act();
  if (!input) return;
  if (lv_indev_get_gesture_dir(input) != LV_DIR_BOTTOM) return;
  if (backlight_panel && !lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN)) return;
  showBacklightPanel();
}

void wallpaperButtonClicked(lv_event_t *) {
  hideBacklightPanel();
  Wallpaper::show();
  last_interaction_at = millis();
  scheduleFullRedraw();
}

void wallpaperClicked(lv_event_t *) {
  wallpaper_exit_requested = false;
  Wallpaper::hide();
  last_interaction_at = millis();
  scheduleFullRedraw();
}

const char *musicModeButtonText(const char *mode) {
  if (!strcmp(mode, "order")) return LV_SYMBOL_LOOP "\n顺序";
  if (!strcmp(mode, "list")) return LV_SYMBOL_LOOP "\n列表";
  if (!strcmp(mode, "track")) return LV_SYMBOL_LOOP "\n单曲";
  if (!strcmp(mode, "shuffle")) return LV_SYMBOL_SHUFFLE "\n随机";
  return LV_SYMBOL_LOOP "\n模式";
}

void formatMusicTime(uint32_t milliseconds, char *output,
                     size_t output_size) {
  const uint32_t total_seconds = milliseconds / 1000;
  snprintf(output, output_size, "%lu:%02lu",
           static_cast<unsigned long>(total_seconds / 60),
           static_cast<unsigned long>(total_seconds % 60));
}

void setMusicLabel(lv_obj_t *object, const char *text) {
  if (object && strcmp(lv_label_get_text(object), text)) {
    lv_label_set_text(object, text);
  }
}

void musicControlClicked(lv_event_t *event) {
  const char *action = static_cast<const char *>(lv_event_get_user_data(event));
  if (!action || !queueMusicControl(action)) {
    setFooter("请稍后");
    return;
  }
  last_interaction_at = millis();
  scheduleFullRedraw();
}

void hideMusicView(lv_event_t *) {
  if (!music_view) return;
  music_view_active = false;
  lv_obj_add_flag(music_view, LV_OBJ_FLAG_HIDDEN);
  scheduleFullRedraw();
}

void showMusicView(lv_event_t *) {
  if (!music_view) return;
  hideBacklightPanel();
  music_view_active = true;
  lv_obj_clear_flag(music_view, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(music_view);
  last_interaction_at = millis();
  scheduleFullRedraw();
}

lv_obj_t *musicButton(lv_obj_t *parent, int x, const char *text,
                      const char *action, lv_obj_t **button_label = nullptr,
                      bool accent = false) {
  lv_obj_t *button = lv_btn_create(parent);
  lv_obj_set_pos(button, x, 370);
  lv_obj_set_size(button, 92, 92);
  lv_obj_set_style_bg_color(button, color(accent ? 0x0A1A2E : 0x111113), 0);
  lv_obj_set_style_shadow_width(button, 0, 0);
  lv_obj_set_style_radius(button, 16, 0);
  lv_obj_set_style_border_width(button, 1, 0);
  lv_obj_set_style_border_color(button,
                                color(accent ? 0x168BFF : 0x2A2A2E), 0);
  lv_obj_set_style_pad_all(button, 0, 0);
  disableScrolling(button);
  lv_obj_add_event_cb(button, musicControlClicked, LV_EVENT_CLICKED,
                      const_cast<char *>(action));
  lv_obj_t *caption = label(button, text, 0, 0, &azoria_font_zh_16);
  lv_obj_set_width(caption, 92);
  lv_obj_set_style_text_align(caption, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_style_text_line_space(caption, 8, 0);
  lv_obj_set_style_text_color(caption,
                              color(accent ? 0x168BFF : 0xF8FAFC), 0);
  lv_obj_center(caption);
  if (button_label) *button_label = caption;
  return button;
}

void createMusicView(lv_obj_t *parent) {
  music_view = lv_obj_create(parent);
  lv_obj_set_pos(music_view, 0, 0);
  lv_obj_set_size(music_view, 480, 480);
  lv_obj_set_style_bg_color(music_view, color(0x050505), 0);
  lv_obj_set_style_bg_opa(music_view, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(music_view, 0, 0);
  lv_obj_set_style_pad_all(music_view, 0, 0);
  disableScrolling(music_view);

  lv_obj_t *back = lv_btn_create(music_view);
  lv_obj_set_pos(back, 16, 16);
  lv_obj_set_size(back, 48, 48);
  lv_obj_set_style_bg_color(back, color(0x111113), 0);
  lv_obj_set_style_shadow_width(back, 0, 0);
  lv_obj_set_style_radius(back, 14, 0);
  lv_obj_set_style_border_width(back, 1, 0);
  lv_obj_set_style_border_color(back, color(0x2A2A2E), 0);
  lv_obj_set_style_pad_all(back, 0, 0);
  lv_obj_add_event_cb(back, hideMusicView, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *back_label = label(back, "<", 0, 0, &lv_font_montserrat_28);
  lv_obj_center(back_label);

  music_title = label(music_view, "暂无音乐", 80, 17,
                      &azoria_font_zh_16);
  lv_obj_set_width(music_title, 252);
  lv_label_set_long_mode(music_title, LV_LABEL_LONG_SCROLL_CIRCULAR);
  music_artist = label(music_view, "", 80, 45, &azoria_font_zh_16);
  lv_obj_set_width(music_artist, 252);
  lv_label_set_long_mode(music_artist, LV_LABEL_LONG_SCROLL_CIRCULAR);
  lv_obj_set_style_text_color(music_artist, color(0x94A3B8), 0);
  music_status = label(music_view, "等待 YangCi", 344, 28,
                       &azoria_font_zh_16);
  lv_obj_set_width(music_status, 116);
  lv_obj_set_style_text_align(music_status, LV_TEXT_ALIGN_RIGHT, 0);
  lv_obj_set_style_text_color(music_status, color(0x168BFF), 0);

  lv_obj_t *divider = lv_obj_create(music_view);
  lv_obj_set_pos(divider, 20, 82);
  lv_obj_set_size(divider, 440, 1);
  lv_obj_set_style_bg_color(divider, color(0x202024), 0);
  lv_obj_set_style_bg_opa(divider, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(divider, 0, 0);
  lv_obj_clear_flag(divider, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);

  music_lyric_previous = label(music_view, "", 48, 112,
                               &azoria_font_zh_16);
  lv_obj_set_size(music_lyric_previous, 384, 42);
  lv_label_set_long_mode(music_lyric_previous, LV_LABEL_LONG_DOT);
  lv_obj_set_style_text_align(music_lyric_previous, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_style_text_color(music_lyric_previous, color(0x66666F), 0);

  lv_obj_t *current_panel = lv_obj_create(music_view);
  lv_obj_set_pos(current_panel, 24, 164);
  lv_obj_set_size(current_panel, 432, 86);
  lv_obj_set_style_bg_color(current_panel, color(0x0A0A0C), 0);
  lv_obj_set_style_bg_opa(current_panel, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(current_panel, 1, 0);
  lv_obj_set_style_border_color(current_panel, color(0x202024), 0);
  lv_obj_set_style_radius(current_panel, 16, 0);
  lv_obj_set_style_pad_all(current_panel, 0, 0);
  disableScrolling(current_panel);

  lv_obj_t *lyric_indicator = lv_obj_create(current_panel);
  lv_obj_set_pos(lyric_indicator, 0, 16);
  lv_obj_set_size(lyric_indicator, 4, 54);
  lv_obj_set_style_bg_color(lyric_indicator, color(0x168BFF), 0);
  lv_obj_set_style_bg_opa(lyric_indicator, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(lyric_indicator, 0, 0);
  lv_obj_set_style_radius(lyric_indicator, 2, 0);
  lv_obj_clear_flag(lyric_indicator,
                    LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);

  music_lyric_current = label(current_panel, "等待歌词", 22, 12,
                              &azoria_font_zh_16);
  lv_obj_set_size(music_lyric_current, 388, 62);
  lv_label_set_long_mode(music_lyric_current, LV_LABEL_LONG_WRAP);
  lv_obj_set_style_text_align(music_lyric_current, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_style_text_color(music_lyric_current, color(0xF8FAFC), 0);
  lv_obj_set_style_text_letter_space(music_lyric_current, 1, 0);

  music_lyric_next = label(music_view, "", 48, 266,
                           &azoria_font_zh_16);
  lv_obj_set_size(music_lyric_next, 384, 42);
  lv_label_set_long_mode(music_lyric_next, LV_LABEL_LONG_DOT);
  lv_obj_set_style_text_align(music_lyric_next, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_style_text_color(music_lyric_next, color(0x66666F), 0);

  music_elapsed_label = staticLabel(music_view, "0:00", 20, 324,
                                    &lv_font_montserrat_14, 0x94A3B8);
  music_duration_label = staticLabel(music_view, "0:00", 422, 324,
                                     &lv_font_montserrat_14, 0x94A3B8);
  lv_obj_set_width(music_duration_label, 38);
  lv_obj_set_style_text_align(music_duration_label, LV_TEXT_ALIGN_RIGHT, 0);
  music_progress_bar = lv_bar_create(music_view);
  lv_obj_set_pos(music_progress_bar, 72, 331);
  lv_obj_set_size(music_progress_bar, 336, 5);
  lv_bar_set_range(music_progress_bar, 0, 1000);
  lv_bar_set_value(music_progress_bar, 0, LV_ANIM_OFF);
  lv_obj_set_style_bg_color(music_progress_bar, color(0x27272A), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(music_progress_bar, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_radius(music_progress_bar, 3, LV_PART_MAIN);
  lv_obj_set_style_bg_color(music_progress_bar, color(0x168BFF),
                            LV_PART_INDICATOR);
  lv_obj_set_style_radius(music_progress_bar, 3, LV_PART_INDICATOR);

  music_buttons[0] = musicButton(music_view, 38,
                                 LV_SYMBOL_PREV "\n上一首", "previous");
  music_buttons[1] = musicButton(music_view, 142,
                                 LV_SYMBOL_PLAY "\n播放", "toggle-play",
                                 &music_play_label, true);
  music_buttons[2] = musicButton(music_view, 246,
                                 LV_SYMBOL_NEXT "\n下一首", "next");
  music_buttons[3] = musicButton(music_view, 350,
                                 LV_SYMBOL_LOOP "\n模式", "cycle-mode",
                                 &music_mode_label);
  lv_obj_add_flag(music_view, LV_OBJ_FLAG_HIDDEN);
}

void createBacklightPanel(lv_obj_t *parent) {
  backlight_panel = card(parent, 13, 13, 454, 154);
  lv_obj_set_style_bg_color(backlight_panel, color(0x111827), 0);
  lv_obj_set_style_border_width(backlight_panel, 1, 0);
  lv_obj_set_style_border_color(backlight_panel, color(0x334155), 0);
  lv_obj_add_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN);

  lv_obj_t *title = staticLabel(
      backlight_panel, "SCREEN LIGHT", 20, 18,
      &lv_font_montserrat_16, 0xF8FAFC);
  lv_obj_set_style_text_opa(title, LV_OPA_70, 0);
  backlight_value = label(backlight_panel, "86%", 372, 14,
                           &lv_font_montserrat_28);
  lv_obj_set_width(backlight_value, 70);
  lv_obj_set_style_text_align(backlight_value, LV_TEXT_ALIGN_RIGHT, 0);
  lv_obj_set_style_text_color(backlight_value, color(0xF8FAFC), 0);
  lv_obj_set_style_text_opa(backlight_value, LV_OPA_COVER, 0);

  backlight_slider = lv_slider_create(backlight_panel);
  lv_obj_set_pos(backlight_slider, 20, 66);
  lv_obj_set_size(backlight_slider, 410, 22);
  lv_slider_set_range(backlight_slider, kMinBacklightPercent, 100);
  lv_slider_set_value(backlight_slider, current_backlight_percent, LV_ANIM_OFF);
  styleSlider(backlight_slider, 410, 0xA9D2FF);
  lv_obj_add_event_cb(
      backlight_slider, backlightChanged, LV_EVENT_VALUE_CHANGED, nullptr);
  lv_obj_add_event_cb(
      backlight_slider, backlightReleased, LV_EVENT_RELEASED, nullptr);
  lv_obj_add_event_cb(
      backlight_slider, backlightReleased, LV_EVENT_PRESS_LOST, nullptr);

  lv_obj_t *close_button = lv_btn_create(backlight_panel);
  lv_obj_set_pos(close_button, 398, 104);
  lv_obj_set_size(close_button, 38, 38);
  lv_obj_set_style_bg_color(close_button, color(0x1D1D1D), 0);
  lv_obj_set_style_shadow_width(close_button, 0, 0);
  lv_obj_set_style_radius(close_button, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_pad_all(close_button, 0, 0);
  disableScrolling(close_button);
  lv_obj_add_event_cb(close_button, closeBacklightPanel, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *close_label = label(close_button, "X", 0, 0,
                                 &lv_font_montserrat_16);
  lv_obj_set_style_text_color(close_label, color(0xF8FAFC), 0);
  lv_obj_center(close_label);
}

lv_obj_t *createInputButton(lv_obj_t *parent, int index, int slot) {
  lv_obj_t *button = lv_btn_create(parent);
  // The exported 36x36 assets contain different transparent side bearings.
  // Position their visible glyphs on the same optical center, rather than
  // aligning the image frame's top-left corner.
  constexpr int kInputIconX = 39;
  lv_obj_set_pos(button, slot * kInputStride, 0);
  lv_obj_set_size(button, kInputButtonWidth, kInputButtonHeight);
  bool selected = index == active_input;
  lv_obj_set_style_bg_color(
      button, color(selected ? 0xE1F4FF : 0x1D1D1D),
      0);
  lv_obj_set_style_shadow_width(button, 0, 0);
  lv_obj_set_style_radius(button, 12, 0);
  lv_obj_set_style_pad_all(button, 0, 0);
  disableScrolling(button);
  lv_obj_set_ext_click_area(button, 3);
  lv_obj_add_event_cb(
      button, inputPressed, LV_EVENT_PRESSED,
      reinterpret_cast<void *>(static_cast<intptr_t>(index)));
  lv_obj_add_event_cb(
      button, inputClicked, LV_EVENT_CLICKED,
      reinterpret_cast<void *>(static_cast<intptr_t>(index)));
  lv_obj_clear_flag(button, LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_add_event_cb(button, inputGesture, LV_EVENT_GESTURE, nullptr);
  lv_obj_add_event_cb(button, screenGesture, LV_EVENT_GESTURE, nullptr);

  if (index == 4) {
    input_icons[index] = createUiImage(button, &icon_tv_active_48,
                                          30, 12,
                                          color(selected ? 0x050505 : 0xEBF4FF));
  } else if (index == 3) {
    input_icons[index] = createUiImage(button, &icon_apple_36,
                                          kInputIconX, 22,
                                          color(selected ? 0x050505 : 0xEBF4FF));
  } else if (index == 1) {
    input_icons[index] = createUiImage(button, &icon_windows_36,
                                          kInputIconX, 24,
                                          color(selected ? 0x050505 : 0xEBF4FF));
  } else if (index == 0) {
    input_icons[index] = createUiImage(button, &icon_windows_36,
                                          kInputIconX, 23,
                                          color(selected ? 0x050505 : 0xEBF4FF));
  } else {
    input_icons[index] = createUiImage(button, &icon_linux_36,
                                          kInputIconX, 23,
                                          color(selected ? 0x050505 : 0xEBF4FF));
  }
  lv_obj_t *caption =
      label(button, kInputLabels[index], 0, 65, &lv_font_montserrat_14);
  lv_obj_set_style_text_color(caption, color(selected ? 0x000000 : 0xEBF4FF),
                              0);
  lv_obj_set_style_text_opa(caption, LV_OPA_50, 0);
  lv_obj_set_width(caption, kInputButtonWidth);
  lv_obj_set_style_text_align(caption, LV_TEXT_ALIGN_CENTER, 0);
  return button;
}

void setControlsEnabled(bool enabled) {
  if (controls_enabled == enabled) return;
  controls_enabled = enabled;
  lv_obj_t *interactive[] = {
      brightness_slider, volume_slider,
  };
  for (lv_obj_t *object : interactive) {
    if (!object) continue;
    if (enabled) {
      lv_obj_clear_state(object, LV_STATE_DISABLED);
    } else {
      lv_obj_add_state(object, LV_STATE_DISABLED);
    }
  }
  // The input and mute tiles remain visually faithful while Desktop is
  // reconnecting. Their handlers still surface a localized failure message.
  if (mute_button) lv_obj_clear_state(mute_button, LV_STATE_DISABLED);
  for (lv_obj_t *button : input_buttons) {
    if (button) lv_obj_clear_state(button, LV_STATE_DISABLED);
  }
}

}  // namespace

void showScreen() {
  lv_obj_clean(lv_scr_act());
  controls = lv_scr_act();
  disableScrolling(controls);
  lv_obj_set_scroll_dir(controls, LV_DIR_NONE);
  current_backlight_percent = loadBacklightSetting();
  wallpaper_idle_minutes = loadWallpaperIdleMinutes();
  applyBacklight(current_backlight_percent);
  lv_obj_add_event_cb(
      controls, screenGesture, LV_EVENT_GESTURE, nullptr);

  createUiImage(controls, &icon_azoria_logo_80, 28, 24,
                   color(0xF8FAFC));
  lv_obj_t *music_open_button = lv_btn_create(controls);
  lv_obj_set_pos(music_open_button, 20, 16);
  lv_obj_set_size(music_open_button, 96, 96);
  lv_obj_set_style_bg_opa(music_open_button, LV_OPA_TRANSP, 0);
  lv_obj_set_style_shadow_width(music_open_button, 0, 0);
  lv_obj_set_style_border_width(music_open_button, 0, 0);
  lv_obj_set_style_pad_all(music_open_button, 0, 0);
  disableScrolling(music_open_button);
  lv_obj_add_event_cb(music_open_button, showMusicView, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *wallpaper_button = DisplayBadge::create(controls);
  lv_obj_add_flag(wallpaper_button, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(
      wallpaper_button, wallpaperButtonClicked, LV_EVENT_CLICKED, nullptr);

  status_dot = lv_obj_create(controls);
  lv_obj_set_pos(status_dot, 446, 20);
  lv_obj_set_size(status_dot, 8, 8);
  lv_obj_set_style_radius(status_dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(status_dot, 0, 0);
  lv_obj_set_style_bg_color(status_dot, color(0x70FF00), 0);
  clock_label = label(controls, "--:--:--", 338, 61,
                      &azoria_font_din_condensed_48);
  lv_obj_set_style_text_color(clock_label, color(0xF8FAFC), 0);
  weekday_label = staticLabel(controls, "星期--", 339, 106,
                              &azoria_font_zh_16, 0xF8FAFC);
  date_label = staticLabel(controls, "----/--/--", 411, 109,
                           &azoria_font_din_condensed_16, 0xF8FAFC);
  lv_obj_set_style_text_opa(weekday_label, LV_OPA_70, 0);
  lv_obj_set_style_text_opa(date_label, LV_OPA_70, 0);
  updateClock();

  lv_obj_t *brightness_card = card(controls, 13, 166, 458, 102);
  lv_obj_set_style_bg_color(brightness_card, color(0x1D1D1D), 0);
  lv_obj_add_flag(brightness_card, LV_OBJ_FLAG_GESTURE_BUBBLE);
  createUiImage(brightness_card, &icon_sun_16, 18, 27,
                   color(0xEBF4FF));
  lv_obj_t *brightness_title =
      staticLabel(brightness_card, "LIGHT", 41, 24, &lv_font_montserrat_16,
                  0xF8FAFC);
  lv_obj_set_style_text_opa(brightness_title, LV_OPA_50, 0);
  brightness_value = label(brightness_card, "50%", 374, 34,
                            &azoria_font_din_condensed_48);
  lv_obj_set_width(brightness_value, 72);
  lv_obj_set_style_text_align(brightness_value, LV_TEXT_ALIGN_RIGHT, 0);
  lv_obj_set_style_text_color(brightness_value, color(0xF8FAFC), 0);
  lv_obj_set_style_text_opa(brightness_value, LV_OPA_COVER, 0);
  for (int index = 0; index < kBrightnessSegmentCount; ++index) {
    lv_obj_t *segment = lv_obj_create(brightness_card);
    brightness_segments[index] = segment;
    lv_obj_set_pos(segment, 19 + static_cast<int>(index * 8.85f), 57);
    lv_obj_set_size(segment, 3, 22);
    lv_obj_set_style_bg_color(segment, color(0x555555), 0);
    lv_obj_set_style_bg_opa(segment, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(segment, 0, 0);
    lv_obj_set_style_radius(segment, 2, 0);
    lv_obj_clear_flag(segment, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  }
  brightness_slider = lv_slider_create(brightness_card);
  lv_obj_add_flag(brightness_slider, LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_set_pos(brightness_slider, 15, 48);
  lv_obj_set_size(brightness_slider, 340, 38);
  lv_slider_set_range(brightness_slider, 0, 100);
  lv_slider_set_value(brightness_slider, 50, LV_ANIM_OFF);
  lv_obj_set_style_bg_opa(brightness_slider, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(brightness_slider, LV_OPA_TRANSP, LV_PART_INDICATOR);
  lv_obj_set_style_bg_opa(brightness_slider, LV_OPA_TRANSP, LV_PART_KNOB);
  lv_obj_set_style_border_width(brightness_slider, 0, LV_PART_MAIN);
  lv_obj_add_event_cb(
      brightness_slider, brightnessPressed, LV_EVENT_PRESSED, nullptr);
  lv_obj_add_event_cb(
      brightness_slider, brightnessChanged, LV_EVENT_VALUE_CHANGED, nullptr);
  lv_obj_add_event_cb(
      brightness_slider, brightnessReleased, LV_EVENT_RELEASED, nullptr);
  lv_obj_add_event_cb(
      brightness_slider, brightnessReleased, LV_EVENT_PRESS_LOST, nullptr);

  lv_obj_t *volume_card = card(controls, 13, 274, 374, 77);
  lv_obj_set_style_bg_color(volume_card, color(0x1D1D1D), 0);
  lv_obj_add_flag(volume_card, LV_OBJ_FLAG_GESTURE_BUBBLE);
  createUiImage(volume_card, &icon_sound_16, 15, 20,
                   color(0xEBF4FF));
  lv_obj_t *volume_title =
      staticLabel(volume_card, "SOUND", 39, 17, &lv_font_montserrat_16,
                  0xF8FAFC);
  lv_obj_set_style_text_opa(volume_title, LV_OPA_50, 0);
  volume_slider = lv_slider_create(volume_card);
  lv_obj_add_flag(volume_slider, LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_set_pos(volume_slider, 15, 53);
  lv_slider_set_range(volume_slider, 0, 100);
  lv_slider_set_value(volume_slider, 20, LV_ANIM_OFF);
  styleSlider(volume_slider, 340, 0xA9D2FF);
  lv_obj_add_event_cb(
      volume_slider, volumePressed, LV_EVENT_PRESSED, nullptr);
  lv_obj_add_event_cb(
      volume_slider, volumeChanged, LV_EVENT_VALUE_CHANGED, nullptr);
  lv_obj_add_event_cb(
      volume_slider, volumeReleased, LV_EVENT_RELEASED, nullptr);
  lv_obj_add_event_cb(
      volume_slider, volumeReleased, LV_EVENT_PRESS_LOST, nullptr);

  mute_button = lv_btn_create(controls);
  lv_obj_set_pos(mute_button, 391, 276);
  lv_obj_set_size(mute_button, 79, 77);
  lv_obj_set_style_bg_color(mute_button, color(0x1D1D1D), 0);
  lv_obj_set_style_shadow_width(mute_button, 0, 0);
  lv_obj_set_style_radius(mute_button, 12, 0);
  lv_obj_set_style_pad_all(mute_button, 0, 0);
  disableScrolling(mute_button);
  lv_obj_add_flag(mute_button, LV_OBJ_FLAG_GESTURE_BUBBLE);
  lv_obj_add_event_cb(mute_button, muteClicked, LV_EVENT_CLICKED, nullptr);
  mute_icon = createUiImage(mute_button, &icon_mute_24, 27, 26,
                               color(0xF04438));
  footer_text = staticLabel(controls, "", 0, 0, &azoria_font_zh_16,
                            0xFF6B6B);
  lv_obj_set_width(footer_text, 200);
  lv_obj_set_style_text_align(footer_text, LV_TEXT_ALIGN_RIGHT, 0);
  lv_obj_align(footer_text, LV_ALIGN_TOP_RIGHT, -16, 132);
  next_clock_update = 0;
  input_strip = lv_obj_create(controls);
  lv_obj_set_pos(input_strip, 13, 360);
  lv_obj_set_size(input_strip, kInputStripWidth, kInputStripHeight);
  lv_obj_set_style_bg_opa(input_strip, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(input_strip, 0, 0);
  lv_obj_set_style_radius(input_strip, 0, 0);
  lv_obj_set_style_pad_all(input_strip, 0, 0);
  lv_obj_set_scroll_dir(input_strip, LV_DIR_HOR);
  lv_obj_set_scrollbar_mode(input_strip, LV_SCROLLBAR_MODE_OFF);
  lv_obj_clear_flag(input_strip, LV_OBJ_FLAG_SCROLL_CHAIN);
  lv_obj_add_flag(input_strip, LV_OBJ_FLAG_SCROLLABLE |
                               LV_OBJ_FLAG_SCROLL_MOMENTUM |
                               LV_OBJ_FLAG_SCROLL_ELASTIC);
  lv_obj_add_event_cb(
      input_strip, inputStripScrolled, LV_EVENT_SCROLL_BEGIN, nullptr);
  lv_obj_add_event_cb(
      input_strip, inputStripScrolled, LV_EVENT_SCROLL_END, nullptr);
  for (int slot = 0; slot < kInputCount; ++slot) {
    int index = kInputOrder[slot];
    input_buttons[index] = createInputButton(input_strip, index, slot);
    lv_obj_add_state(input_buttons[index], LV_STATE_DISABLED);
  }
  createBacklightPanel(controls);
  Wallpaper::createView(controls, wallpaperClicked);
  createMusicView(controls);
  updateInputButtons();
  updateMuteVisual();
  updateBrightnessSegments(50);

  controls_enabled = true;
  setControlsEnabled(false);
  last_interaction_at = millis();
  wallpaper_exit_requested = false;
}

void refresh() {
  if (!controls || !brightness_slider) return;
  if (wallpaper_exit_requested) {
    wallpaper_exit_requested = false;
    Wallpaper::hide();
    scheduleFullRedraw();
  }
  if (!Wallpaper::active() && !music_view_active &&
      wallpaper_idle_minutes > 0 &&
      millis() - last_interaction_at >=
          static_cast<uint32_t>(wallpaper_idle_minutes) * 60UL * 1000UL) {
    Wallpaper::show();
    scheduleFullRedraw();
  }
  if (Wallpaper::active()) {
    Wallpaper::refresh();
    return;
  }
  if (static_cast<int32_t>(millis() - next_clock_update) >= 0) {
    updateClock();
    next_clock_update = millis() + 1000;
  }
  RemoteState state = getRemoteState();
  bool brightness_needs_reconcile =
      !brightness_dragging && !state.brightness_pending &&
      lv_slider_get_value(brightness_slider) != state.brightness;
  bool volume_needs_reconcile =
      !volume_dragging && !state.volume_pending &&
      lv_slider_get_value(volume_slider) != state.volume;
  bool mute_needs_reconcile =
      !state.mute_pending && local_muted != state.muted;
  int reported_input = inputIndex(state.input);
  bool input_needs_reconcile =
      !state.input_pending && reported_input >= 0 &&
      active_input != static_cast<uint16_t>(reported_input);
  bool enabled_needs_reconcile = controls_enabled != state.ready;
  if (state.revision == shown_revision &&
      !brightness_needs_reconcile && !volume_needs_reconcile &&
      !mute_needs_reconcile &&
      !input_needs_reconcile &&
      !enabled_needs_reconcile) {
    return;
  }
  shown_revision = state.revision;
  setControlsEnabled(state.ready);

  lv_obj_set_style_bg_color(
      status_dot,
      color(!state.ready ? 0xF59E0B :
            state.online ? 0x70FF00 : 0xEF4444),
      0);

  if (brightness_needs_reconcile) {
    lv_slider_set_value(
        brightness_slider, state.brightness, LV_ANIM_OFF);
    lv_label_set_text_fmt(brightness_value, "%d%%", state.brightness);
    updateBrightnessSegments(state.brightness);
  }
  if (volume_needs_reconcile) {
    lv_slider_set_value(volume_slider, state.volume, LV_ANIM_OFF);
    if (volume_value) lv_label_set_text_fmt(volume_value, "%d", state.volume);
  }
  if (mute_needs_reconcile) {
    local_muted = state.muted;
    updateMuteVisual();
  }
  if (input_needs_reconcile) {
    active_input = static_cast<uint16_t>(reported_input);
  }
  if (!state.input_pending) {
    pending_input = -1;
  }
  updateInputButtons(state.input_pending);

  setMusicLabel(music_title,
                state.music_available ? state.music_title : "暂无音乐");
  setMusicLabel(music_artist,
                state.music_available ? state.music_artist
                                      : "打开播放器后自动同步");
  setMusicLabel(music_status,
                state.music_available
                    ? (state.music_playing ? "正在播放" : "已暂停")
                    : "未检测到播放器");
  setMusicLabel(music_lyric_previous,
                state.music_available ? state.music_lyric_previous : "");
  setMusicLabel(music_lyric_current,
                state.music_available && state.music_lyric_current[0]
                    ? state.music_lyric_current
                    : (state.music_available ? "暂无同步歌词" : "等待歌词"));
  setMusicLabel(music_lyric_next,
                state.music_available ? state.music_lyric_next : "");
  setMusicLabel(music_play_label,
                state.music_playing ? LV_SYMBOL_PAUSE "\n暂停"
                                    : LV_SYMBOL_PLAY "\n播放");
  setMusicLabel(music_mode_label, musicModeButtonText(state.music_mode));
  char elapsed_text[16];
  char duration_text[16];
  formatMusicTime(state.music_position_ms, elapsed_text,
                  sizeof(elapsed_text));
  formatMusicTime(state.music_duration_ms, duration_text,
                  sizeof(duration_text));
  setMusicLabel(music_elapsed_label, elapsed_text);
  setMusicLabel(music_duration_label, duration_text);
  if (music_progress_bar) {
    const uint64_t scaled_progress = state.music_duration_ms > 0
        ? static_cast<uint64_t>(state.music_position_ms) * 1000 /
              state.music_duration_ms
        : 0;
    const uint32_t progress = static_cast<uint32_t>(
        scaled_progress > 1000 ? 1000 : scaled_progress);
    lv_bar_set_value(music_progress_bar, static_cast<int32_t>(progress),
                     LV_ANIM_OFF);
  }
  for (lv_obj_t *button : music_buttons) {
    if (!button) continue;
    if (state.music_available) lv_obj_clear_state(button, LV_STATE_DISABLED);
    else lv_obj_add_state(button, LV_STATE_DISABLED);
  }

  const char *message = localizedMessage(state.message);
  if (footer_text && strcmp(lv_label_get_text(footer_text), message)) {
    lv_label_set_text(footer_text, message);
    lv_obj_align(footer_text, LV_ALIGN_TOP_RIGHT, -16, 132);
  }
}

bool takeFullRedrawRequest() {
  if (post_interaction_redraw_due == 0 ||
      brightness_dragging || volume_dragging ||
      static_cast<int32_t>(millis() - post_interaction_redraw_due) < 0) {
    return false;
  }
  post_interaction_redraw_due = 0;
  return true;
}

void noteInteraction() {
  last_interaction_at = millis();
  if (Wallpaper::active()) wallpaper_exit_requested = true;
}

void setWallpaperIdleMinutes(uint16_t minutes) {
  if (!validWallpaperIdleMinutes(minutes) ||
      wallpaper_idle_minutes == minutes) return;
  wallpaper_idle_minutes = minutes;
  saveWallpaperIdleMinutes(minutes);
  Serial.printf("WALLPAPER_IDLE_MINUTES=%u\n", minutes);
}

}  // namespace DisplayControl
