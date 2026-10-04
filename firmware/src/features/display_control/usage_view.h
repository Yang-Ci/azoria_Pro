#pragma once

#include <lvgl.h>
#include "features/display_control/service.h"

namespace DisplayControl::UsageView {
void create(lv_obj_t *parent);
void show(uint8_t selected_page = 0);
void hide();
bool active();
void refresh(const RemoteState &state);
}  // namespace DisplayControl::UsageView
