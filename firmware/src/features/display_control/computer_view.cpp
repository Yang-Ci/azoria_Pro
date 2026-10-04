#include "features/display_control/computer_view.h"
#include <Arduino.h>
#include "features/display_control/screen.h"

namespace DisplayControl::ComputerView {
namespace {
lv_obj_t *view, *status, *values[4], *details[4], *charts[4];
lv_chart_series_t *series[4];
uint32_t shown_revision = UINT32_MAX;
bool shown_ready = false;
constexpr uint32_t inks[] = {0x20DFE5, 0xB69AF1, 0x69A7FF, 0xFFC166};

lv_obj_t *text(lv_obj_t *parent, const char *content, int x, int y, const lv_font_t *font, uint32_t ink) {
  lv_obj_t *object = lv_label_create(parent);
  lv_label_set_text(object, content);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_style_text_font(object, font, 0);
  lv_obj_set_style_text_color(object, lv_color_hex(ink), 0);
  return object;
}
void rate(uint32_t bytes, char *buffer, size_t size) {
  if (bytes >= 1048576) snprintf(buffer, size, "%.1f MB/s", bytes / 1048576.0);
  else snprintf(buffer, size, "%.1f KB/s", bytes / 1024.0);
}
void back(lv_event_t *) { hide(); }
}

void create(lv_obj_t *parent) {
  view = lv_obj_create(parent);
  lv_obj_remove_style_all(view);
  lv_obj_set_size(view, 480, 480);
  lv_obj_set_style_bg_color(view, lv_color_hex(0x0B0C10), 0);
  lv_obj_set_style_bg_opa(view, LV_OPA_COVER, 0);
  lv_obj_clear_flag(view, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_GESTURE_BUBBLE);
  text(view, "PC STATUS", 20, 18, &lv_font_montserrat_28, 0xF6F1E9);
  status = text(view, "WAITING FOR DESKTOP", 21, 55, &lv_font_montserrat_16, 0x929292);
  lv_obj_t *button = lv_btn_create(view);
  lv_obj_set_pos(button, 418, 15); lv_obj_set_size(button, 44, 44);
  lv_obj_set_style_bg_color(button, lv_color_hex(0x242630), 0);
  lv_obj_set_style_shadow_width(button, 0, 0);
  lv_obj_add_event_cb(button, back, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *back_text = text(button, LV_SYMBOL_LEFT, 0, 0, &lv_font_montserrat_18, 0xF6F1E9);
  lv_obj_center(back_text);
  const char *titles[] = {"CPU", "MEMORY", "DOWNLOAD", "UPLOAD"};
  for (int index = 0; index < 4; ++index) {
    lv_obj_t *card = lv_obj_create(view);
    lv_obj_set_pos(card, 20 + (index % 2) * 226, 88 + (index / 2) * 158);
    lv_obj_set_size(card, 214, 146);
    lv_obj_set_style_bg_color(card, lv_color_hex(0x15171D), 0);
    lv_obj_set_style_border_width(card, 0, 0); lv_obj_set_style_radius(card, 12, 0);
    lv_obj_set_style_pad_all(card, 0, 0); lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
    text(card, titles[index], 12, 10, &lv_font_montserrat_16, inks[index]);
    values[index] = text(card, "--", 12, 35, &lv_font_montserrat_28, 0xF6F1E9);
    details[index] = text(card, index < 2 ? "Waiting for sample" : "Waiting for network", 12, 70, &lv_font_montserrat_16, 0x929292);
    charts[index] = lv_chart_create(card);
    lv_obj_set_pos(charts[index], 12, 98); lv_obj_set_size(charts[index], 190, 38);
    lv_obj_set_style_bg_opa(charts[index], LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(charts[index], 0, 0);
    lv_obj_set_style_pad_all(charts[index], 0, 0);
    lv_obj_set_style_size(charts[index], 0, LV_PART_INDICATOR);
    lv_obj_set_style_line_width(charts[index], 2, LV_PART_ITEMS);
    lv_chart_set_type(charts[index], LV_CHART_TYPE_LINE);
    lv_chart_set_range(charts[index], LV_CHART_AXIS_PRIMARY_Y, 0, 100);
    lv_chart_set_point_count(charts[index], kComputerTrendPoints);
    lv_chart_set_div_line_count(charts[index], 0, 0);
    lv_obj_clear_flag(charts[index], LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    series[index] = lv_chart_add_series(charts[index], lv_color_hex(inks[index]), LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_all_value(charts[index], series[index], LV_CHART_POINT_NONE);
  }
  text(view, "Last 60 seconds  /  2s refresh", 20, 430, &lv_font_montserrat_16, 0x929292);
  lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN);
}
void show() {
  if (!view) return;
  setComputerViewActive(true); noteInteraction(); shown_revision = UINT32_MAX;
  lv_obj_clear_flag(view, LV_OBJ_FLAG_HIDDEN); lv_obj_move_foreground(view);
}
void hide() { if (view) lv_obj_add_flag(view, LV_OBJ_FLAG_HIDDEN); setComputerViewActive(false); noteInteraction(); }
bool active() { return view && !lv_obj_has_flag(view, LV_OBJ_FLAG_HIDDEN); }
void refresh(const RemoteState &state) {
  if (!active()) return;
  const auto &data = state.computer;
  const bool ready = state.online && data.available && millis() - data.received_at_ms < 10000;
  if (shown_revision == data.revision && shown_ready == ready) return;
  shown_revision = data.revision; shown_ready = ready;
  lv_label_set_text(status, ready ? "ONLINE  /  LIVE METRICS" : data.supported ? "OFFLINE  /  WAITING FOR SYNC" : "WAITING FOR DESKTOP UPDATE");
  lv_obj_set_style_text_color(status, lv_color_hex(ready ? 0x20DFE5 : 0xFFC166), 0);
  char buffer[48];
  snprintf(buffer, sizeof(buffer), "%d%%", data.cpu_percent);
  lv_label_set_text(values[0], ready && data.cpu_percent >= 0 ? buffer : "--");
  snprintf(buffer, sizeof(buffer), "%d%%", data.memory_percent);
  lv_label_set_text(values[1], ready && data.memory_percent >= 0 ? buffer : "--");
  snprintf(buffer, sizeof(buffer), "%.1f / %.1f GB", data.memory_used_mb / 1024.0, data.memory_total_mb / 1024.0);
  lv_label_set_text(details[1], ready ? buffer : "Waiting for sample");
  lv_label_set_text(details[0], ready ? "All cores average" : "Waiting for sample");
  rate(data.network_rx_bps, buffer, sizeof(buffer));
  lv_label_set_text(values[2], ready && data.network_available ? buffer : "--");
  rate(data.network_tx_bps, buffer, sizeof(buffer));
  lv_label_set_text(values[3], ready && data.network_available ? buffer : "--");
  for (int index = 2; index < 4; ++index) lv_label_set_text(details[index], ready && data.network_available ? "Active interfaces" : "Waiting for network");
  for (int chart = 0; chart < 4; ++chart) {
    for (size_t point = 0; point < kComputerTrendPoints; ++point) {
      lv_chart_set_value_by_id(charts[chart], series[chart], point, ready && data.trends[chart][point] >= 0 ? data.trends[chart][point] : LV_CHART_POINT_NONE);
    }
    lv_chart_refresh(charts[chart]);
  }
}
}
