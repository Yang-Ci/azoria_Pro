#pragma once
#include <lvgl.h>
#include "features/display_control/service.h"

namespace DisplayControl::PowerView {
void create(lv_obj_t *parent);
void show();
void hide();
void runScrollDiagnostics();
bool scrollDiagnosticsActive();
bool active();
int16_t scrollOffset();
uint32_t visualRevision();
void refresh(const RemoteState &state);
}
