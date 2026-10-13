#pragma once

#include <stdint.h>
#include <string.h>

namespace DisplayPixels {

struct Area { int16_t x1, y1, x2, y2; };

inline Area panelArea(Area area, int side, uint16_t rotation) {
  if (rotation == 90) return {static_cast<int16_t>(side - 1 - area.y2), area.x1,
                             static_cast<int16_t>(side - 1 - area.y1), area.x2};
  if (rotation == 180) return {static_cast<int16_t>(side - 1 - area.x2),
                              static_cast<int16_t>(side - 1 - area.y2),
                              static_cast<int16_t>(side - 1 - area.x1),
                              static_cast<int16_t>(side - 1 - area.y1)};
  if (rotation == 270) return {area.y1, static_cast<int16_t>(side - 1 - area.x2),
                              area.y2, static_cast<int16_t>(side - 1 - area.x1)};
  return area;
}

// Input is a packed LVGL draw area in internal RAM. Only the idle panel buffer
// is written. Build physical rows locally, including the 90/270-degree paths.
inline void writeArea(const uint16_t *source, uint16_t *target, int side,
                      Area logical, uint16_t rotation) {
  const int width = logical.x2 - logical.x1 + 1;
  const int height = logical.y2 - logical.y1 + 1;
  const Area physical = panelArea(logical, side, rotation);
  uint16_t row[480];
  const int physical_width = physical.x2 - physical.x1 + 1;
  for (int y = physical.y1; y <= physical.y2; ++y) {
    const int local_y = y - physical.y1;
    uint16_t *destination = target + y * side + physical.x1;
    if (rotation == 0) {
      memcpy(destination, source + local_y * width, width * sizeof(uint16_t));
      continue;
    }
    for (int x = 0; x < physical_width; ++x) {
      int source_x, source_y;
      if (rotation == 180) {
        source_x = width - 1 - x;
        source_y = height - 1 - local_y;
      } else if (rotation == 90) {
        source_x = local_y;
        source_y = height - 1 - x;
      } else {
        source_x = width - 1 - local_y;
        source_y = x;
      }
      row[x] = source[source_y * width + source_x];
    }
    memcpy(destination, row, physical_width * sizeof(uint16_t));
  }
}

inline void syncArea(const uint16_t *source, uint16_t *target, int side,
                     Area logical, uint16_t rotation) {
  const Area physical = panelArea(logical, side, rotation);
  const size_t bytes = (physical.x2 - physical.x1 + 1) * sizeof(uint16_t);
  for (int y = physical.y1; y <= physical.y2; ++y) {
    const size_t offset = y * side + physical.x1;
    memcpy(target + offset, source + offset, bytes);
  }
}

}  // namespace DisplayPixels
