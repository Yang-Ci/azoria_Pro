#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace Wallpaper {

// The ROM decoder supplies RGB888 MCU blocks in internal RAM. Convert a row
// there before copying it to PSRAM, avoiding two external byte stores per pixel.
inline bool copyJpegBlock(const uint8_t *rgb, uint16_t *output,
                          uint16_t side, uint16_t left, uint16_t top,
                          uint16_t right, uint16_t bottom) {
  if (!rgb || !output || left > right || top > bottom ||
      right >= side || bottom >= side) return false;
  const size_t width = right - left + 1;
  uint16_t row[16];
  for (uint16_t y = top; y <= bottom; ++y) {
    for (size_t x = 0; x < width; x += 16) {
      const size_t count = width - x < 16 ? width - x : 16;
      for (size_t pixel = 0; pixel < count; ++pixel) {
        row[pixel] = static_cast<uint16_t>(
            ((rgb[0] & 0xf8) << 8) | ((rgb[1] & 0xfc) << 3) | (rgb[2] >> 3));
        rgb += 3;
      }
      memcpy(output + static_cast<size_t>(y) * side + left + x,
             row, count * sizeof(uint16_t));
    }
  }
  return true;
}

}  // namespace Wallpaper
