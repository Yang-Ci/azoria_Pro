#pragma once

#include <Arduino.h>

#include "services/device_config.h"

namespace DisplayControl {

struct RemoteState {
  bool online = false;
  bool ready = false;
  int brightness = 50;
  int volume = 20;
  bool muted = false;
  char input[12] = "usbc";
  char message[48] = "Connecting";
  bool brightness_pending = false;
  bool volume_pending = false;
  bool mute_pending = false;
  bool input_pending = false;
  bool music_available = false;
  bool music_playing = false;
  char music_title[96] = "No music";
  char music_artist[64] = "";
  char music_mode[12] = "unknown";
  char music_source[12] = "other";
  uint32_t revision = 0;
};

void startRemote(const DeviceConfig &config);
DeviceConfig getDesktopConfig();
RemoteState getRemoteState();
bool queueNumericControl(const char *control, int value, bool final_value = true);
bool queueBooleanControl(const char *control, bool value);
bool queueStringControl(const char *control, const char *value);
bool queueMusicControl(const char *action);

}  // namespace DisplayControl
