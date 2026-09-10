#pragma once

#include <Arduino.h>
#include <lvgl.h>

namespace Wallpaper {

bool begin();
void createView(lv_obj_t *parent, lv_event_cb_t exit_callback);
void show();
void hide();
bool active();
String currentHash();
const char *storageKind();
size_t packageLimit();
void refresh();
bool sync(const String &host, uint16_t port, const String &sha256,
          size_t size);

}  // namespace Wallpaper
