#pragma once

#include <stdint.h>

namespace Wallpaper {

struct PlaybackStep {
  uint16_t index;
  uint32_t next_due;
  uint32_t skipped;
  bool wrapped;
};

// Called only once the deadline is due. Unsigned subtraction also works when
// millis() wraps. Advance along the media clock instead of playing stale frames.
inline PlaybackStep playbackStep(uint16_t index, uint16_t count,
                                 uint16_t delay_ms, uint32_t due,
                                 uint32_t now) {
  const uint32_t steps = 1 + (now - due) / delay_ms;
  const uint32_t position = index + steps;
  return {static_cast<uint16_t>(position % count), due + steps * delay_ms,
          steps - 1, position >= count};
}

}  // namespace Wallpaper
