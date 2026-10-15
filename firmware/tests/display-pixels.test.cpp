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
  // Reusing a scroll must preserve the scanout buffer and all pixels outside
  // the viewport, for both directions and all four display rotations.
  for (uint16_t rotation : {0, 90, 180, 270}) {
    for (int delta : {-5, -2, -1, 1, 2, 5}) {
      constexpr DisplayPixels::Area viewport{0, 1, 7, 6};
      std::array<uint16_t, side * side> logical{}, physical{}, target{};
      for (int i = 0; i < side * side; ++i) logical[i] = i + 1;
      DisplayPixels::writeArea(logical.data(), physical.data(), side, {0,0,7,7}, rotation);
      const auto visible = physical;
      target.fill(0xdead);
      assert(DisplayPixels::copyScrolledArea(physical.data(), target.data(), side, viewport, delta, rotation));
      assert(physical == visible);
      for (int y = 0; y < side; ++y) for (int x = 0; x < side; ++x) {
        const int px = rotation == 90 ? side - 1 - y : rotation == 180 ? side - 1 - x : rotation == 270 ? y : x;
        const int py = rotation == 90 ? x : rotation == 180 ? side - 1 - y : rotation == 270 ? side - 1 - x : y;
        const bool retained = y >= viewport.y1 && y <= viewport.y2 &&
                              y + delta >= viewport.y1 && y + delta <= viewport.y2;
        assert(target[py * side + px] == (retained ? logical[(y + delta) * side + x] : 0xdead));
      }
      // Complete a real frame: preserve the header, reuse old rows, paint
      // only the new strip, then reconcile the old buffer for a partial draw.
      auto new_logical = logical;
      const DisplayPixels::Area exposed = delta > 0
          ? DisplayPixels::Area{0, static_cast<int16_t>(viewport.y2 - delta + 1), 7, 6}
          : DisplayPixels::Area{0, 1, 7, static_cast<int16_t>(viewport.y1 - delta - 1)};
      std::array<uint16_t, side * side> strip{}, expected{};
      int offset = 0;
      for (int y = exposed.y1; y <= exposed.y2; ++y) for (int x = 0; x < side; ++x) {
        const uint16_t value = 1000 + y * side + x;
        new_logical[y * side + x] = value;
        strip[offset++] = value;
      }
      for (int y = viewport.y1; y <= viewport.y2; ++y) {
        if (y >= exposed.y1 && y <= exposed.y2) continue;
        for (int x = 0; x < side; ++x) new_logical[y * side + x] = logical[(y + delta) * side + x];
      }
      target = visible;
      assert(DisplayPixels::copyScrolledArea(physical.data(), target.data(), side, viewport, delta, rotation));
      DisplayPixels::writeArea(strip.data(), target.data(), side, exposed, rotation);
      DisplayPixels::writeArea(new_logical.data(), expected.data(), side, {0,0,7,7}, rotation);
      assert(target == expected);
      auto idle = visible;
      DisplayPixels::syncArea(target.data(), idle.data(), side, viewport, rotation);
      assert(idle == target);
      assert(!DisplayPixels::copyScrolledArea(physical.data(), target.data(), side, viewport, 0, rotation));
      assert(!DisplayPixels::copyScrolledArea(physical.data(), target.data(), side, viewport, 6, rotation));
      assert(!DisplayPixels::copyScrolledArea(physical.data(), target.data(), side, viewport, -6, rotation));
    }
  }
}
