#pragma once

#include <Arduino.h>

#include "services/device_config.h"

namespace DisplayControl {

constexpr size_t kComputerTrendPoints = 30;
struct ComputerState {
  bool supported = false;
  bool available = false;
  bool network_available = false;
  int16_t cpu_percent = -1;
  int16_t memory_percent = -1;
  uint32_t memory_used_mb = 0;
  uint32_t memory_total_mb = 0;
  uint32_t network_rx_bps = 0;
  uint32_t network_tx_bps = 0;
  int16_t trends[4][kComputerTrendPoints]{};
  uint32_t received_at_ms = 0;
  uint32_t revision = 0;
};

struct UsageState {
  bool supported = false;
  bool codex_available = false;
  bool codex_stale = false;
  char codex_plan[20]{};
  uint32_t primary_minutes = 0;
  int16_t primary_remaining = -1;  // Tenths of a percent; -1 means unavailable.
  uint32_t primary_resets_at = 0;
  uint32_t secondary_minutes = 0;
  int16_t secondary_remaining = -1;
  uint32_t secondary_resets_at = 0;
  uint32_t codex_sampled_at = 0;
  uint8_t provider_count = 0;
  uint8_t provider_index = 0;
  bool api_available = false;
  bool api_stale = false;
  bool api_paused = false;
  bool api_error = false;
  char api_name[52]{};
  char api_unit[16]{};
  char api_remaining[40] = "--";
  char api_compact[28] = "--";
  char api_scale[8]{};
  char api_used[40] = "--";
  char api_recent[40] = "--";
  char api_requests[40] = "--";
  uint32_t api_sampled_at = 0;
  uint32_t received_at_ms = 0;
  uint32_t revision = 0;
};

struct RemoteState {
  UsageState usage;
  ComputerState computer;
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
  bool touch_sleep_enabled = false;
  uint16_t touch_sleep_start_minutes = 0;
  uint16_t touch_sleep_end_minutes = 0;
  bool touch_sleep_active = false;
  uint16_t touch_rotation_degrees = 0;
  bool music_available = false;
  bool music_playing = false;
  bool music_can_seek = false;
  bool music_has_artwork = false;
  uint32_t music_artwork_revision = 0;
  uint32_t music_artwork_accent = 0x168BFF;
  char music_title[96] = "No music";
  char music_artist[64] = "";
  char music_mode[12] = "unknown";
  char music_source[12] = "other";
  uint32_t music_position_ms = 0;
  uint32_t music_duration_ms = 0;
  char music_lyric_previous[128] = "";
  char music_lyric_current[128] = "";
  char music_lyric_next[128] = "";
  char music_lyric_extra[4][128]{};
  uint32_t revision = 0;
};

void startRemote(const DeviceConfig &config);
DeviceConfig getDesktopConfig();
RemoteState getRemoteState();
void selectUsageProvider(uint8_t index);
void requestUsageSync();
void setComputerViewActive(bool active);
bool queueNumericControl(const char *control, int value, bool final_value = true);
bool queueBooleanControl(const char *control, bool value);
bool queueStringControl(const char *control, const char *value);
bool queueMusicControl(const char *action, uint32_t position_ms = 0);
void copyMusicArtwork(uint8_t *pixels, size_t size);

}  // namespace DisplayControl
