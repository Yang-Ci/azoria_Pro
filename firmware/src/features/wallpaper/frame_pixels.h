#pragma once

#include <stdint.h>
#include <string.h>

namespace Wallpaper {

// Gather one rotated source row in internal RAM, then expand and write a whole
// physical row. Small PSRAM stores are much slower than bulk row copies on S3.
// Called only for the 240/320 pixel profiles and only with the idle panel buffer.
inline void __attribute__((optimize("O3"))) expandFrame(
    const uint16_t *source, uint16_t *target, int side, uint16_t rotation) {
  uint16_t input[320];
  uint16_t row[480];
  int last_y = -1;
  for (int y = 0; y < 480; ++y) {
    const int sy = y * side / 480;
    if (sy != last_y) {
      if (rotation == 0) {
        memcpy(input, source + sy * side, side * sizeof(uint16_t));
      } else if (rotation == 180) {
        for (int x = 0; x < side; ++x)
          input[x] = source[(side - 1 - sy) * side + side - 1 - x];
      } else if (rotation == 90) {
        for (int x = 0; x < side; ++x)
          input[x] = source[(side - 1 - x) * side + sy];
      } else {
        for (int x = 0; x < side; ++x)
          input[x] = source[x * side + side - 1 - sy];
      }
      for (int x = 0; x < 480; ++x) row[x] = input[x * side / 480];
      last_y = sy;
    }
    memcpy(target + y * 480, row, sizeof(row));
  }
}

}  // namespace Wallpaper
