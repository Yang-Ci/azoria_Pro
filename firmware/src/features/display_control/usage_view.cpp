#include "features/display_control/usage_view.h"

#include <Arduino.h>
#include <ctype.h>
#include <math.h>
#include <time.h>

#include "features/display_control/screen.h"
#include "ui/assets/app_fonts.h"

namespace DisplayControl::UsageView {
namespace {
constexpr uint32_t kAccent = 0x20DFE5;
constexpr uint32_t kSecondary = 0xB69AF1;
constexpr uint32_t kWarning = 0xFFC166;
constexpr uint32_t kWhite = 0xF6F1E9;
constexpr uint32_t kMuted = 0x929292;
constexpr uint32_t kProAccent = 0xDDBF7A;
lv_obj_t *view, *codex_page, *api_page, *title, *dot, *modal, *dialog;
lv_obj_t *pro_gauge_rail, *quota_separator;
lv_obj_t *primary_value, *primary_plan, *primary_period, *primary_reset;
lv_obj_t *secondary_period, *secondary_value, *secondary_reset, *codex_status;
lv_obj_t *provider_button, *provider_name, *provider_index;
lv_obj_t *balance_button, *balance_value, *balance_scale, *balance_unit;
lv_obj_t *recent_value, *requests_value, *api_status;
lv_obj_t *full_name, *full_value, *full_unit;
lv_obj_t *tabs[2], *tab_labels[2], *ticks[61], *bars[40];
lv_point_t tick_points[61][2];
uint8_t page = 0;
uint32_t shown_revision = UINT32_MAX;
uint32_t last_update = 0;
bool shown_online = false;
bool entrance_pending = false;
bool modal_open = false;
bool pro_style = false;
int32_t modal_level = 0;
int32_t tab_levels[2] = {0, 0};
lv_style_transition_dsc_t press_transition;
lv_color_filter_dsc_t press_filter;
struct Meter {
  lv_obj_t **segments;
  int count;
  uint32_t ink;
  int32_t level = 0;
  int32_t target = -1;
  uint32_t track = 0x303030;
};
Meter primary_meter{ticks, 61, kAccent};
Meter secondary_meter{bars, 40, kSecondary};
UsageState current;

lv_color_t color(uint32_t hex) { return lv_color_hex(hex); }

void animate(void *target, lv_anim_exec_xcb_t callback, int32_t from, int32_t to,
             uint32_t duration, uint32_t delay = 0, lv_anim_ready_cb_t ready = nullptr) {
  lv_anim_del(target, callback);
  lv_anim_t animation;
  lv_anim_init(&animation);
  lv_anim_set_var(&animation, target);
  lv_anim_set_exec_cb(&animation, callback);
  lv_anim_set_values(&animation, from, to);
  lv_anim_set_time(&animation, duration);
  lv_anim_set_delay(&animation, delay);
  lv_anim_set_path_cb(&animation, lv_anim_path_ease_out);
  lv_anim_set_ready_cb(&animation, ready);
  lv_anim_start(&animation);
}

lv_color_t brighten(const lv_color_filter_dsc_t *, lv_color_t ink, lv_opa_t opacity) {
  return lv_color_mix(color(kWhite), ink, opacity);
}

void pressFeedback(lv_obj_t *button) {
  lv_obj_set_style_color_filter_dsc(button, &press_filter, 0);
  lv_obj_set_style_color_filter_opa(button, LV_OPA_TRANSP, 0);
  lv_obj_set_style_color_filter_opa(button, 30, LV_STATE_PRESSED);
  lv_obj_set_style_transition(button, &press_transition, 0);
  lv_obj_set_style_transition(button, &press_transition, LV_STATE_PRESSED);
}

void meterMotion(void *target, int32_t level) {
  auto &meter = *static_cast<Meter *>(target);
  meter.level = level;
  // Blend only the moving boundary; settled ticks retain the original colors.
  for (int index = 0; index < meter.count; ++index) {
    const int32_t fill = level - index * 255;
    const lv_opa_t opacity = fill <= 0 ? 0 : fill >= 255 ? 255 : fill;
    const lv_color_t ink = lv_color_mix(color(meter.ink), color(meter.track), opacity);
    if (meter.segments == ticks) lv_obj_set_style_line_color(meter.segments[index], ink, 0);
    else lv_obj_set_style_bg_color(meter.segments[index], ink, 0);
  }
}

void finishMeter(Meter &meter) {
  lv_anim_del(&meter, meterMotion);
  meterMotion(&meter, meter.target < 0 ? 0 : meter.target);
}

void updateMeter(Meter &meter, int16_t remaining, bool entrance, bool smooth,
                 uint32_t duration, uint32_t delay = 0) {
  const int32_t target = remaining < 0 ? 0 : (min(1000, static_cast<int>(remaining)) * meter.count + 500) / 1000 * 255;
  if (entrance) {
    lv_anim_del(&meter, meterMotion);
    meterMotion(&meter, 0);
  }
  if (meter.target == target && !entrance && smooth && remaining >= 0) return;
  meter.target = target;
  if (remaining >= 0 && smooth && meter.level != target) {
    animate(&meter, meterMotion, meter.level, target, duration, delay);
  } else finishMeter(meter);
}

void pageMotion(void *target, int32_t progress) {
  auto *object = static_cast<lv_obj_t *>(target);
  const int offset = object == api_page ? 24 : -24;
  lv_obj_set_style_translate_x(object, offset * (255 - progress) / 255, 0);
  lv_obj_set_style_opa(object, progress, 0);
}

void settlePages() {
  for (lv_obj_t *object : {codex_page, api_page}) {
    lv_anim_del(object, pageMotion);
    lv_obj_set_style_translate_x(object, 0, 0);
    lv_obj_set_style_opa(object, LV_OPA_COVER, 0);
  }
}

void tabMotion(void *target, int32_t progress) {
  const int index = target == tabs[1] ? 1 : 0;
  tab_levels[index] = progress;
  const bool pro_tab = pro_style && index == 0;
  lv_obj_set_style_bg_color(tabs[index], lv_color_mix(color(pro_tab ? 0x272116 : 0x0B2629), color(0x111111), progress), 0);
  lv_obj_set_style_text_color(tab_labels[index], lv_color_mix(color(pro_tab ? kProAccent : kAccent), color(kMuted), progress), 0);
}

void applyCodexStyle(bool pro) {
  if (pro_style == pro) return;
  pro_style = pro;
  primary_meter.ink = pro ? kProAccent : kAccent;
  primary_meter.track = pro ? 0x302D26 : 0x303030;
  if (pro) lv_obj_clear_flag(pro_gauge_rail, LV_OBJ_FLAG_HIDDEN);
  else lv_obj_add_flag(pro_gauge_rail, LV_OBJ_FLAG_HIDDEN);
  for (lv_obj_t *object : {quota_separator, secondary_period, secondary_value, secondary_reset}) {
    if (pro) lv_obj_add_flag(object, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_clear_flag(object, LV_OBJ_FLAG_HIDDEN);
  }
  for (int index = 0; index < 61; ++index) {
    const float angle = (150 + index * 240.0f / 60) * 3.14159265f / 180;
    const int inner = pro ? (index % 5 == 0 ? 151 : 157) : (index % 5 == 0 ? 134 : 140);
    const int outer = pro ? 176 : 160;
    const int center_y = pro ? 196 : 178;
    tick_points[index][0] = {static_cast<lv_coord_t>(240 + cosf(angle) * inner), static_cast<lv_coord_t>(center_y + sinf(angle) * inner)};
    tick_points[index][1] = {static_cast<lv_coord_t>(240 + cosf(angle) * outer), static_cast<lv_coord_t>(center_y + sinf(angle) * outer)};
    lv_line_set_points(ticks[index], tick_points[index], 2);
    lv_obj_set_style_line_width(ticks[index], pro ? (index % 5 == 0 ? 5 : 3) : (index % 5 == 0 ? 7 : 6), 0);
  }
  for (int index = 0; index < 40; ++index) {
    if (pro) lv_obj_add_flag(bars[index], LV_OBJ_FLAG_HIDDEN);
    else lv_obj_clear_flag(bars[index], LV_OBJ_FLAG_HIDDEN);
  }
  lv_obj_set_y(primary_period, pro ? 224 : 200);
  lv_obj_set_y(primary_reset, pro ? 266 : 234);
  lv_obj_set_pos(primary_plan, 328, pro ? 22 : 26);
  lv_obj_set_size(primary_plan, pro ? 64 : 96, pro ? 26 : LV_SIZE_CONTENT);
  lv_obj_set_style_text_align(primary_plan, pro ? LV_TEXT_ALIGN_CENTER : LV_TEXT_ALIGN_LEFT, 0);
  lv_obj_set_style_text_color(primary_plan, color(pro ? kProAccent : kMuted), 0);
  lv_obj_set_style_text_letter_space(primary_plan, pro ? 2 : 0, 0);
  lv_obj_set_style_pad_top(primary_plan, pro ? 3 : 0, 0);
  lv_obj_set_style_bg_color(primary_plan, color(0x18150F), 0);
  lv_obj_set_style_bg_opa(primary_plan, pro ? LV_OPA_COVER : LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_color(primary_plan, color(0x55472D), 0);
  lv_obj_set_style_border_width(primary_plan, pro ? 1 : 0, 0);
  lv_obj_set_style_radius(primary_plan, pro ? 4 : 0, 0);
  meterMotion(&primary_meter, primary_meter.level);
  meterMotion(&secondary_meter, secondary_meter.level);
  for (int index = 0; index < 2; ++index) tabMotion(tabs[index], tab_levels[index]);
}

void modalMotion(void *, int32_t progress) {
  modal_level = progress;
  lv_obj_set_style_opa(modal, progress, 0);
  lv_obj_set_style_translate_y(dialog, (255 - progress) * 12 / 255, 0);
}

void modalClosed(lv_anim_t *) {
  if (!modal_open) lv_obj_add_flag(modal, LV_OBJ_FLAG_HIDDEN);
}

void resetModal() {
  lv_anim_del(modal, modalMotion);
  modal_open = false;
  modalMotion(modal, 0);
  lv_obj_add_flag(modal, LV_OBJ_FLAG_HIDDEN);
}

void flat(lv_obj_t *object, int x, int y, int width, int height, uint32_t bg = 0x080808) {
  lv_obj_set_pos(object, x, y);
  lv_obj_set_size(object, width, height);
  lv_obj_set_style_bg_color(object, color(bg), 0);
  lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(object, 0, 0);
  lv_obj_set_style_radius(object, 0, 0);
  lv_obj_set_style_pad_all(object, 0, 0);
  lv_obj_set_style_shadow_width(object, 0, 0);
  lv_obj_clear_flag(object, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_GESTURE_BUBBLE);
}

lv_obj_t *text(lv_obj_t *parent, const char *value, int x, int y,
               const lv_font_t *font, uint32_t ink = kWhite, int width = 0) {
  lv_obj_t *object = lv_label_create(parent);
  lv_label_set_text(object, value);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_style_text_font(object, font, 0);
  lv_obj_set_style_text_color(object, color(ink), 0);
  if (width) lv_obj_set_width(object, width);
  lv_obj_clear_flag(object, LV_OBJ_FLAG_CLICKABLE);
  return object;
}

void centerText(lv_obj_t *object, int y) {
  lv_obj_set_width(object, 432);
  lv_obj_set_style_text_align(object, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(object, 24, y);
}

lv_obj_t *rule(lv_obj_t *parent, int x, int y, int width, int height, uint32_t ink = 0x303030) {
  lv_obj_t *object = lv_obj_create(parent);
  flat(object, x, y, width, height, ink);
  lv_obj_clear_flag(object, LV_OBJ_FLAG_CLICKABLE);
  return object;
}

void accountText(char *out, size_t size) {
  snprintf(out, size, "账户 %u / %u", current.provider_index + 1, current.provider_count);
}

void closeModal(lv_event_t *) {
  modal_open = false;
  animate(modal, modalMotion, modal_level, 0, 140, 0, modalClosed);
  noteInteraction();
}

void showFullAmount(lv_event_t *) {
  if (!current.api_available) return;
  char account[48];
  accountText(account, sizeof(account));
  lv_label_set_text(full_name, account);
  lv_label_set_text(full_value, current.api_remaining);
  lv_obj_set_style_text_font(full_value, strlen(current.api_remaining) <= 14 ? &lv_font_montserrat_36 : &lv_font_montserrat_28, 0);
  lv_label_set_text(full_unit, current.api_unit);
  modal_open = true;
  lv_obj_clear_flag(modal, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(modal);
  animate(modal, modalMotion, modal_level, 255, 180);
  noteInteraction();
}

void choosePage(uint8_t selected, bool smooth = true) {
  if (selected == page && smooth) return;
  const bool transition = smooth && active();
  settlePages();
  finishMeter(primary_meter);
  finishMeter(secondary_meter);
  page = selected;
  lv_label_set_text(title, page ? "API" : "CODEX");
  if (page) lv_obj_add_flag(primary_plan, LV_OBJ_FLAG_HIDDEN);
  else lv_obj_clear_flag(primary_plan, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(page ? codex_page : api_page, LV_OBJ_FLAG_HIDDEN);
  lv_obj_clear_flag(page ? api_page : codex_page, LV_OBJ_FLAG_HIDDEN);
  if (transition) animate(page ? api_page : codex_page, pageMotion, 0, 255, 200);
  for (int index = 0; index < 2; ++index) {
    const int32_t target = index == page ? 255 : 0;
    if (transition) animate(tabs[index], tabMotion, tab_levels[index], target, 160);
    else { lv_anim_del(tabs[index], tabMotion); tabMotion(tabs[index], target); }
  }
  resetModal();
  shown_revision = UINT32_MAX;
  requestUsageSync();
  noteInteraction();
}

void tabClicked(lv_event_t *event) {
  choosePage(lv_event_get_target(event) == tabs[1] ? 1 : 0);
}

void pageGesture(lv_event_t *) {
  lv_indev_t *input = lv_indev_get_act();
  if (!input || !lv_obj_has_flag(modal, LV_OBJ_FLAG_HIDDEN)) return;
  const lv_dir_t direction = lv_indev_get_gesture_dir(input);
  if (direction == LV_DIR_LEFT || direction == LV_DIR_RIGHT) {
    lv_indev_wait_release(input);
    choosePage(direction == LV_DIR_LEFT ? 1 : 0);
  }
}

void backClicked(lv_event_t *) { hide(); noteInteraction(); }

void cycleProvider(lv_event_t *) {
  if (current.provider_count < 2) return;
  current.provider_index = (current.provider_index + 1) % current.provider_count;
  selectUsageProvider(current.provider_index);
  // Invalidate the old amount and its modal before an asynchronous account switch.
  current.api_available = false;
  resetModal();
  noteInteraction();
}

void periodText(uint32_t minutes, char *out, size_t size) {
  if (!minutes) snprintf(out, size, "周期未知");
  else if (minutes == 10080) snprintf(out, size, "周额度");
  else if (minutes % 1440 == 0) snprintf(out, size, "%lu 天额度", static_cast<unsigned long>(minutes / 1440));
  else if (minutes % 60 == 0) snprintf(out, size, "%lu 小时额度", static_cast<unsigned long>(minutes / 60));
  else snprintf(out, size, "%lu 分钟额度", static_cast<unsigned long>(minutes));
}

void resetText(uint32_t resets_at, char *out, size_t size) {
  const time_t now = time(nullptr);
  if (!resets_at || now < 1577836800) { snprintf(out, size, "等待时间同步"); return; }
  if (now >= resets_at) { snprintf(out, size, "等待新周期数据"); return; }
  const uint32_t minutes = (resets_at - now + 59) / 60;
  if (minutes >= 1440) snprintf(out, size, "%lu 天 %lu 时后重置", static_cast<unsigned long>(minutes / 1440), static_cast<unsigned long>(minutes % 1440 / 60));
  else snprintf(out, size, "%02lu:%02lu 后重置", static_cast<unsigned long>(minutes / 60), static_cast<unsigned long>(minutes % 60));
}

void percentText(int16_t tenths, char *out, size_t size, bool suffix) {
  if (tenths < 0) { snprintf(out, size, "--"); return; }
  if (tenths % 10) snprintf(out, size, "%d.%d%s", tenths / 10, tenths % 10, suffix ? "%" : "");
  else snprintf(out, size, "%d%s", tenths / 10, suffix ? "%" : "");
}

void sampledText(uint32_t sampled_at, bool stale, char *out, size_t size) {
  if (stale) { snprintf(out, size, "数据较旧"); return; }
  const time_t now = time(nullptr);
  if (!sampled_at || now < 1577836800) { snprintf(out, size, "等待采样"); return; }
  const uint32_t age = now > sampled_at ? now - sampled_at : 0;
  if (age < 60) snprintf(out, size, "刚刚同步");
  else if (age < 3600) snprintf(out, size, "%lu 分钟前同步", static_cast<unsigned long>(age / 60));
  else snprintf(out, size, "%lu 小时前同步", static_cast<unsigned long>(age / 3600));
}

void createCodex() {
  codex_page = lv_obj_create(view);
  flat(codex_page, 0, 64, 480, 360);
  pro_gauge_rail = lv_arc_create(codex_page);
  flat(pro_gauge_rail, 56, 12, 368, 368);
  lv_obj_set_style_bg_opa(pro_gauge_rail, LV_OPA_TRANSP, 0);
  lv_obj_remove_style(pro_gauge_rail, nullptr, LV_PART_KNOB);
  lv_obj_set_style_arc_width(pro_gauge_rail, 1, LV_PART_MAIN);
  lv_obj_set_style_arc_color(pro_gauge_rail, color(0x403829), LV_PART_MAIN);
  lv_obj_set_style_arc_opa(pro_gauge_rail, LV_OPA_TRANSP, LV_PART_INDICATOR);
  lv_obj_set_style_arc_rounded(pro_gauge_rail, false, LV_PART_MAIN);
  lv_arc_set_rotation(pro_gauge_rail, 150);
  lv_arc_set_bg_angles(pro_gauge_rail, 0, 240);
  lv_obj_clear_flag(pro_gauge_rail, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_flag(pro_gauge_rail, LV_OBJ_FLAG_HIDDEN);
  // A true 0-100% scale: the concept image's ornamental angle numbers are omitted.
  for (int index = 0; index < 61; ++index) {
    const float angle = (150 + index * 240.0f / 60) * 3.14159265f / 180;
    const int inner = index % 5 == 0 ? 134 : 140;
    tick_points[index][0] = {static_cast<lv_coord_t>(240 + cosf(angle) * inner), static_cast<lv_coord_t>(178 + sinf(angle) * inner)};
    tick_points[index][1] = {static_cast<lv_coord_t>(240 + cosf(angle) * 160), static_cast<lv_coord_t>(178 + sinf(angle) * 160)};
    ticks[index] = lv_line_create(codex_page);
    lv_line_set_points(ticks[index], tick_points[index], 2);
    lv_obj_set_style_line_width(ticks[index], index % 5 == 0 ? 7 : 6, 0);
    lv_obj_set_style_line_color(ticks[index], color(0x303030), 0);
    lv_obj_clear_flag(ticks[index], LV_OBJ_FLAG_CLICKABLE);
  }
  primary_value = text(codex_page, "--%", 0, 0, &azoria_font_usage_110); centerText(primary_value, 80);
  primary_period = text(codex_page, "等待额度数据", 0, 0, &azoria_font_zh_28); centerText(primary_period, 200);
  primary_reset = text(codex_page, "在桌面端完成一次 Codex 对话", 0, 0, &azoria_font_zh_16, kMuted); centerText(primary_reset, 234);
  quota_separator = rule(codex_page, 24, 265, 432, 1);
  secondary_period = text(codex_page, "周额度 /", 24, 284, &azoria_font_zh_16);
  secondary_value = text(codex_page, "--", 330, 272, &azoria_font_din_condensed_48, kWhite, 126);
  lv_obj_set_style_text_align(secondary_value, LV_TEXT_ALIGN_RIGHT, 0);
  for (int index = 0; index < 40; ++index) {
    bars[index] = lv_obj_create(codex_page);
    flat(bars[index], 24 + index * 11, 324, 6, 14, 0x303030);
    lv_obj_clear_flag(bars[index], LV_OBJ_FLAG_CLICKABLE);
  }
  secondary_reset = text(codex_page, "", 94, 284, &azoria_font_zh_16, kMuted, 222);
  lv_label_set_long_mode(secondary_reset, LV_LABEL_LONG_DOT);
  codex_status = text(codex_page, "等待同步", 286, 342, &azoria_font_zh_16, kMuted, 170);
  lv_obj_set_style_text_align(codex_status, LV_TEXT_ALIGN_RIGHT, 0);
  lv_label_set_long_mode(codex_status, LV_LABEL_LONG_DOT);
}

void createApi() {
  api_page = lv_obj_create(view); flat(api_page, 0, 64, 480, 360);
  provider_button = lv_btn_create(api_page); flat(provider_button, 24, 14, 432, 52);
  pressFeedback(provider_button);
  lv_obj_add_event_cb(provider_button, cycleProvider, LV_EVENT_CLICKED, nullptr);
  provider_name = text(provider_button, "账户余额", 14, 10, &azoria_font_zh_28, kWhite, 324);
  lv_label_set_long_mode(provider_name, LV_LABEL_LONG_DOT);
  provider_index = text(provider_button, "", 345, 18, &lv_font_montserrat_16, kAccent, 72);
  lv_obj_set_style_text_align(provider_index, LV_TEXT_ALIGN_RIGHT, 0);
  rule(api_page, 24, 73, 432, 1);
  balance_button = lv_btn_create(api_page); flat(balance_button, 24, 80, 432, 160);
  pressFeedback(balance_button);
  lv_obj_add_event_cb(balance_button, showFullAmount, LV_EVENT_CLICKED, nullptr);
  rule(balance_button, 0, 8, 5, 140, kAccent);
  text(balance_button, "账户余额", 20, 8, &azoria_font_zh_16, kMuted);
  balance_unit = text(balance_button, "", 20, 30, &azoria_font_zh_16, kAccent);
  balance_value = text(balance_button, "--", 20, 44, &azoria_font_usage_110);
  balance_scale = text(balance_button, "", 330, 98, &azoria_font_zh_28, kSecondary);
  text(balance_button, "点击查看完整金额", 20, 140, &azoria_font_zh_16, kMuted);
  for (int index = 0; index < 29; ++index) rule(api_page, 24 + index * 15, 242, 1, index % 5 == 0 ? 12 : 6, index % 5 == 0 ? kAccent : 0x30322F);
  rule(api_page, 24, 272, 432, 1);
  text(api_page, "近 24 小时消耗", 24, 288, &azoria_font_zh_16, kMuted);
  text(api_page, "累计请求", 264, 288, &azoria_font_zh_16, kMuted);
  rule(api_page, 240, 289, 1, 46);
  recent_value = text(api_page, "--", 24, 310, &lv_font_montserrat_28, kWhite, 204);
  requests_value = text(api_page, "--", 264, 310, &lv_font_montserrat_28, kWhite, 192);
  lv_label_set_long_mode(recent_value, LV_LABEL_LONG_DOT);
  lv_label_set_long_mode(requests_value, LV_LABEL_LONG_DOT);
  api_status = text(api_page, "等待桌面同步", 24, 340, &azoria_font_zh_16, kMuted, 432);
}

void bubbleGestures(lv_obj_t *object) {
  lv_obj_add_flag(object, LV_OBJ_FLAG_GESTURE_BUBBLE);
  for (uint32_t index = 0; index < lv_obj_get_child_cnt(object); ++index) bubbleGestures(lv_obj_get_child(object, index));
}
}  // namespace

void create(lv_obj_t *parent) {
  static const lv_style_prop_t press_properties[] = {LV_STYLE_COLOR_FILTER_OPA, LV_STYLE_PROP_INV};
  lv_style_transition_dsc_init(&press_transition, press_properties, lv_anim_path_ease_out, 100, 0, nullptr);
  lv_color_filter_dsc_init(&press_filter, brighten);
  view = lv_obj_create(parent); flat(view, 0, 0, 480, 480);
  lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_event_cb(view, pageGesture, LV_EVENT_GESTURE, nullptr);
  lv_obj_t *back = lv_btn_create(view); flat(back, 16, 10, 48, 44);
  pressFeedback(back);
  lv_obj_add_event_cb(back, backClicked, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *back_label = text(back, LV_SYMBOL_LEFT, 0, 0, &lv_font_montserrat_22); lv_obj_center(back_label);
  title = text(view, "CODEX", 0, 18, &lv_font_montserrat_28); centerText(title, 18);
  lv_obj_set_style_text_letter_space(title, 3, 0);
  primary_plan = text(view, "", 328, 26, &lv_font_montserrat_16, kMuted, 96);
  lv_label_set_long_mode(primary_plan, LV_LABEL_LONG_DOT);
  dot = lv_obj_create(view); flat(dot, 440, 27, 10, 10, kAccent); lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
  rule(view, 24, 63, 432, 1);
  createCodex(); createApi();
  for (int index = 0; index < 2; ++index) {
    tabs[index] = lv_btn_create(view); flat(tabs[index], index * 240, 424, 240, 56, 0x111111);
    pressFeedback(tabs[index]);
    lv_obj_add_event_cb(tabs[index], tabClicked, LV_EVENT_CLICKED, nullptr);
    tab_labels[index] = text(tabs[index], index ? "API" : "Codex", 0, 0, &lv_font_montserrat_22); lv_obj_center(tab_labels[index]);
  }
  rule(view, 239, 424, 1, 56);
  modal = lv_obj_create(view); flat(modal, 0, 0, 480, 480, 0x060705);
  lv_obj_set_style_bg_opa(modal, LV_OPA_90, 0);
  dialog = lv_obj_create(modal); flat(dialog, 20, 100, 440, 288, 0x171717);
  lv_obj_set_style_radius(dialog, 12, 0);
  text(dialog, "完整余额", 24, 22, &azoria_font_zh_28, kAccent);
  full_name = text(dialog, "", 24, 64, &azoria_font_zh_16, kMuted, 392); lv_label_set_long_mode(full_name, LV_LABEL_LONG_DOT);
  full_value = text(dialog, "", 24, 99, &lv_font_montserrat_36, kWhite, 392);
  lv_label_set_long_mode(full_value, LV_LABEL_LONG_WRAP);
  full_unit = text(dialog, "", 24, 172, &lv_font_montserrat_18, kMuted);
  lv_obj_t *close = lv_btn_create(dialog); flat(close, 24, 216, 392, 48, 0x0B2629);
  pressFeedback(close);
  lv_obj_set_style_radius(close, 6, 0);
  lv_obj_add_event_cb(close, closeModal, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *close_label = text(close, "关闭", 0, 0, &azoria_font_zh_16, kAccent); lv_obj_center(close_label);
  bubbleGestures(codex_page); bubbleGestures(api_page);
  bubbleGestures(tabs[0]); bubbleGestures(tabs[1]);
  choosePage(0, false);
}

void show(uint8_t selected_page) {
  if (!view) return;
  const bool opening = !active();
  choosePage(selected_page == 1 ? 1 : 0, false);
  if (opening) entrance_pending = true;
  lv_obj_clear_flag(view, LV_OBJ_FLAG_HIDDEN); lv_obj_move_foreground(view);
  shown_revision = UINT32_MAX; requestUsageSync(); noteInteraction();
}

void hide() {
  if (!view) return;
  entrance_pending = false;
  settlePages();
  finishMeter(primary_meter);
  finishMeter(secondary_meter);
  for (int index = 0; index < 2; ++index) {
    lv_anim_del(tabs[index], tabMotion);
    tabMotion(tabs[index], index == page ? 255 : 0);
  }
  if (view) lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN);
  resetModal();
}

bool active() { return view && !lv_obj_has_flag(view, LV_OBJ_FLAG_HIDDEN); }

void refresh(const RemoteState &state) {
  if (!active()) return;
  if (shown_revision == state.usage.revision && shown_online == state.online && millis() - last_update < 1000) return;
  shown_revision = state.usage.revision; shown_online = state.online; last_update = millis();
  current = state.usage;
  const bool connected = state.online && current.supported && millis() - current.received_at_ms < 45000;
  const time_t now = time(nullptr);
  const bool primary_expired = current.primary_resets_at && now >= current.primary_resets_at;
  const bool secondary_expired = current.secondary_resets_at && now >= current.secondary_resets_at;
  lv_obj_set_style_bg_color(dot, color(connected ? 0x6DE79C : kWarning), 0);
  char buffer[96];
  if (!page) {
    snprintf(buffer, sizeof(buffer), "%s", current.codex_plan);
    for (char *letter = buffer; *letter; ++letter) *letter = toupper(static_cast<unsigned char>(*letter));
    applyCodexStyle(strcmp(buffer, "PRO") == 0);
    lv_label_set_text(primary_plan, current.codex_available || pro_style ? buffer : "");
    int16_t primary = current.codex_available ? current.primary_remaining : -1;
    uint32_t primary_minutes = current.primary_minutes;
    uint32_t primary_resets_at = current.primary_resets_at;
    if (pro_style) {
      // A weekly window can arrive in either slot. Never relabel a short window.
      primary = -1;
      primary_minutes = 10080;
      primary_resets_at = 0;
      if (current.codex_available) {
        if (current.primary_minutes == 10080 && current.primary_remaining >= 0) {
          primary = current.primary_remaining;
          primary_resets_at = current.primary_resets_at;
        } else if (current.secondary_minutes == 10080 && current.secondary_remaining >= 0) {
          primary = current.secondary_remaining;
          primary_resets_at = current.secondary_resets_at;
        }
      }
    }
    const int16_t secondary = !pro_style && current.codex_available && current.secondary_minutes ? current.secondary_remaining : -1;
    const bool hero_expired = primary_resets_at && now >= primary_resets_at;
    const bool quota_available = current.codex_available && (!pro_style || primary >= 0);
    percentText(primary, buffer, sizeof(buffer), true); lv_label_set_text(primary_value, buffer);
    // Three-digit percentages need the same compact font as decimal values.
    const lv_font_t *primary_font = primary >= 1000 || (primary >= 0 && primary % 10) ? &azoria_font_usage_80 : &azoria_font_usage_110;
    lv_obj_set_style_text_font(primary_value, primary_font, 0);
    lv_obj_set_y(primary_value, (pro_style ? 128 : 80) + (azoria_font_usage_110.line_height - primary_font->line_height) / 2);
    periodText(primary_minutes, buffer, sizeof(buffer)); lv_label_set_text(primary_period, current.codex_available || pro_style ? buffer : "等待额度数据");
    resetText(primary_resets_at, buffer, sizeof(buffer));
    lv_label_set_text(primary_reset, quota_available ? buffer : pro_style ? "等待额度数据" : "在桌面端完成一次 Codex 对话");
    char secondary_title[48];
    periodText(current.secondary_minutes, buffer, sizeof(buffer));
    snprintf(secondary_title, sizeof(secondary_title), "%s /", buffer);
    lv_label_set_text(secondary_period, current.codex_available && current.secondary_minutes ? secondary_title : "暂无第二周期");
    percentText(secondary, buffer, sizeof(buffer), true); lv_label_set_text(secondary_value, buffer);
    resetText(current.secondary_resets_at, buffer, sizeof(buffer)); lv_label_set_text(secondary_reset, current.codex_available && current.secondary_minutes ? buffer : "");
    lv_obj_update_layout(secondary_period);
    const int reset_x = 24 + lv_obj_get_width(secondary_period) + 8;
    lv_obj_set_x(secondary_reset, reset_x);
    lv_obj_set_width(secondary_reset, 316 - reset_x);
    const bool entrance = entrance_pending && quota_available && connected;
    if (entrance) entrance_pending = false;
    updateMeter(primary_meter, primary, entrance && !hero_expired,
                connected && !hero_expired, entrance ? 460 : 300);
    updateMeter(secondary_meter, secondary, !pro_style && entrance && !secondary_expired,
                !pro_style && connected && !secondary_expired, entrance ? 380 : 300, entrance ? 80 : 0);
    const bool stale = current.codex_stale || (pro_style ? hero_expired : primary_expired || secondary_expired) ||
        (current.codex_sampled_at && now > current.codex_sampled_at && now - current.codex_sampled_at > 21600);
    sampledText(current.codex_sampled_at, stale, buffer, sizeof(buffer));
    lv_label_set_text(codex_status, !connected ? (current.supported ? "离线 · 上次数据" : "等待桌面同步") : !quota_available ? "等待额度数据" : buffer);
    lv_obj_set_style_text_color(codex_status, color(stale || !connected ? kWarning : kMuted), 0);
    lv_obj_set_style_text_color(primary_value, color(hero_expired ? kMuted : kWhite), 0);
  } else {
    lv_label_set_text(provider_name, current.provider_count ? "账户余额" : "在桌面端添加 API");
    snprintf(buffer, sizeof(buffer), "%u/%u", current.provider_index + 1, current.provider_count);
    lv_label_set_text(provider_index, current.provider_count > 1 ? buffer : "");
    lv_label_set_text(balance_unit, current.api_available ? current.api_unit : "");
    lv_label_set_text(balance_value, current.api_available ? current.api_compact : "--");
    lv_obj_set_style_text_font(balance_value, &azoria_font_usage_110, 0);
    lv_obj_update_layout(balance_value);
    if (lv_obj_get_width(balance_value) > 342) lv_obj_set_style_text_font(balance_value, &lv_font_montserrat_48, 0);
    lv_obj_update_layout(balance_value);
    lv_obj_set_pos(balance_scale, min(374, 30 + lv_obj_get_width(balance_value)), 98);
    lv_label_set_text(balance_scale, current.api_available ? current.api_scale : "");
    lv_label_set_text(recent_value, current.api_available ? current.api_recent : "--");
    lv_label_set_text(requests_value, current.api_available ? current.api_requests : "--");
    sampledText(current.api_sampled_at, current.api_stale, buffer, sizeof(buffer));
    const char *message = !connected ? (current.supported ? "离线 · 上次数据" : "等待桌面同步") :
        !current.provider_count ? "请在桌面端配置 API 服务" : current.api_paused ? "已暂停 · 上次数据" :
        current.api_error ? "查询失败 · 上次数据" : !current.api_available ? "等待余额查询" : buffer;
    lv_label_set_text(api_status, message);
    lv_obj_set_style_text_color(api_status, color(!connected || current.api_stale || current.api_error || current.api_paused ? kWarning : kMuted), 0);
    // A refreshed account or amount also refreshes the open details dialog.
    if (!lv_obj_has_flag(modal, LV_OBJ_FLAG_HIDDEN)) {
      if (!current.api_available) resetModal();
      else { lv_label_set_text(full_value, current.api_remaining); lv_label_set_text(full_unit, current.api_unit); }
    }
  }
}
}  // namespace DisplayControl::UsageView
