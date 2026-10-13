#include <array>
#include <cassert>
#include "platform/display_pixels.h"

int main() {
  constexpr int side = 8;
  for (uint16_t rotation : {0, 90, 180, 270}) {
    std::array<uint16_t, side * side> front{}, back{};
    // Render an entire frame in packed strips, like LVGL's partial draw mode.
    for (int y = 0; y < side; y += 2) {
      std::array<uint16_t, side * 2> strip{};
      for (int index = 0; index < side * 2; ++index) strip[index] = y * side + index + 1;
      DisplayPixels::writeArea(strip.data(), back.data(), side,
                               {0, static_cast<int16_t>(y), side - 1,
                                static_cast<int16_t>(y + 1)}, rotation);
    }
    for (int y = 0; y < side; ++y) {
      for (int x = 0; x < side; ++x) {
        const int px = rotation == 90 ? side - 1 - y
                     : rotation == 180 ? side - 1 - x
                     : rotation == 270 ? y : x;
        const int py = rotation == 90 ? x
                     : rotation == 180 ? side - 1 - y
                     : rotation == 270 ? side - 1 - x : y;
        assert(back[py * side + px] == y * side + x + 1);
      }
    }
    DisplayPixels::syncArea(back.data(), front.data(), side, {0, 0, 7, 7}, rotation);
    assert(front == back);
    const auto before = front;
    const uint16_t change[] = {101, 102, 103, 104, 105, 106};
    DisplayPixels::writeArea(change, back.data(), side, {1, 2, 3, 3}, rotation);
    // The visible buffer must not change until a scan boundary has passed.
    assert(front == before);
    DisplayPixels::syncArea(back.data(), front.data(), side, {1, 2, 3, 3}, rotation);
    assert(front == back);
    int changed = 0;
    for (int index = 0; index < side * side; ++index) changed += front[index] != before[index];
    assert(changed == 6);
  }
}
