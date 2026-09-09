#pragma once

#include <stdint.h>

namespace DisplayControl {

void showScreen();
void refresh();
bool takeFullRedrawRequest();
void noteInteraction();
void setWallpaperIdleMinutes(uint16_t minutes);

}  // namespace DisplayControl
