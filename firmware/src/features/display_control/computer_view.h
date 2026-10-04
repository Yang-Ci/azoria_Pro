#pragma once
#include <lvgl.h>
#include "features/display_control/service.h"

namespace DisplayControl::ComputerView {
void create(lv_obj_t *parent);
void show();
void hide();
bool active();
void refresh(const RemoteState &state);
}
