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
inline void __attribute__((optimize("O3"))) writeArea(const uint16_t *source, uint16_t *target, int side,
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
    if (rotation == 180) {
      const uint16_t *input = source + (height - local_y) * width;
      for (int x = 0; x < physical_width; ++x) row[x] = *--input;
    } else if (rotation == 90) {
      const uint16_t *input = source + (height - 1) * width + local_y;
      for (int x = 0; x < physical_width; ++x) {
        row[x] = *input;
        if (x + 1 < physical_width) input -= width;
      }
    } else {
      const uint16_t *input = source + width - 1 - local_y;
      for (int x = 0; x < physical_width; ++x) {
        row[x] = *input;
        if (x + 1 < physical_width) input += width;
      }
    }
    memcpy(destination, row, physical_width * sizeof(uint16_t));
  }
}

// Copy the retained part of a vertically scrolled viewport from the visible
// framebuffer into the idle framebuffer. The exposed rows are rendered by
// LVGL afterwards. Distinct source/target buffers keep scanout untouched.
inline bool copyScrolledArea(const uint16_t *source, uint16_t *target, int side,
                             Area viewport, int delta, uint16_t rotation) {
  const int height = viewport.y2 - viewport.y1 + 1;
  if (delta == 0 || delta <= -height || delta >= height) return false;
  Area destination = viewport;
  if (delta > 0) destination.y2 -= delta;
  else destination.y1 -= delta;
  Area previous = destination;
  previous.y1 += delta;
  previous.y2 += delta;
  const Area to = panelArea(destination, side, rotation);
  const Area from = panelArea(previous, side, rotation);
  const int width = to.x2 - to.x1 + 1;
  const int rows = to.y2 - to.y1 + 1;
  if (width == side) {
    memcpy(target + to.y1 * side, source + from.y1 * side,
           static_cast<size_t>(rows) * side * sizeof(uint16_t));
  } else {
    for (int row = 0; row < rows; ++row)
      memcpy(target + (to.y1 + row) * side + to.x1,
             source + (from.y1 + row) * side + from.x1,
             width * sizeof(uint16_t));
  }
  return true;
}

inline void syncArea(const uint16_t *source, uint16_t *target, int side,
                     Area logical, uint16_t rotation) {
  const Area physical = panelArea(logical, side, rotation);
  const size_t bytes = (physical.x2 - physical.x1 + 1) * sizeof(uint16_t);
  if (physical.x2 - physical.x1 + 1 == side) {
    const size_t offset = physical.y1 * side;
    memcpy(target + offset, source + offset,
           static_cast<size_t>(physical.y2 - physical.y1 + 1) * bytes);
    return;
  }
  for (int y = physical.y1; y <= physical.y2; ++y) {
    const size_t offset = y * side + physical.x1;
    memcpy(target + offset, source + offset, bytes);
  }
}

}  // namespace DisplayPixels
