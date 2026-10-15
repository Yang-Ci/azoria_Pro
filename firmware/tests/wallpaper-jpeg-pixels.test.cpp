#include <array>
#include <cassert>
#include <vector>
#include "features/wallpaper/frame_pixels.h"
#include "features/wallpaper/jpeg_pixels.h"

int main() {
  for (int side : {240, 320}) {
    std::vector<uint16_t> source(side * side);
    for (int y = 0; y < side; ++y)
      for (int x = 0; x < side; ++x) source[y * side + x] = y * 37 + x * 13;
    for (uint16_t rotation : {0, 90, 180, 270}) {
      std::vector<uint16_t> output(480 * 480 + 2, 0xbeef);
      Wallpaper::expandFrame(source.data(), output.data() + 1,
                             side, rotation);
      assert(output.front() == 0xbeef && output.back() == 0xbeef);
      for (int y = 0; y < 480; ++y) {
        for (int x = 0; x < 480; ++x) {
          const int px = x * side / 480, py = y * side / 480;
          const int sx = rotation == 180 ? side - 1 - px
                       : rotation == 90 ? py
                       : rotation == 270 ? side - 1 - py : px;
          const int sy = rotation == 180 ? side - 1 - py
                       : rotation == 90 ? side - 1 - px
                       : rotation == 270 ? px : py;
          assert(output[1 + y * 480 + x] == source[sy * side + sx]);
        }
      }
    }
  }

  const uint8_t colors[] = {255, 0, 0, 0, 255, 0, 0, 0, 255,
                           255, 255, 255, 0, 0, 0, 128, 128, 128};
  std::array<uint16_t, 25> output;
  output.fill(0x1234);
  assert(Wallpaper::copyJpegBlock(colors, output.data(), 5, 1, 2, 3, 3));
  assert(output[11] == 0xf800 && output[12] == 0x07e0 && output[13] == 0x001f);
  assert(output[16] == 0xffff && output[17] == 0 && output[18] == 0x8410);
  assert(output[10] == 0x1234 && output[14] == 0x1234 && output[19] == 0x1234);
  assert(!Wallpaper::copyJpegBlock(colors, output.data(), 5, 4, 2, 5, 3));
  assert(!Wallpaper::copyJpegBlock(colors, output.data(), 5, 2, 3, 1, 3));
  assert(!Wallpaper::copyJpegBlock(nullptr, output.data(), 5, 0, 0, 1, 1));

  // Cross the 16-pixel chunk boundary and end at the last pixel of the image.
  std::array<uint8_t, 17 * 2 * 3> rgb;
  rgb.fill(255);
  std::array<uint16_t, 20 * 20> large;
  large.fill(0);
  assert(Wallpaper::copyJpegBlock(rgb.data(), large.data(), 20, 3, 18, 19, 19));
  for (size_t y = 18; y < 20; ++y) {
    assert(large[y * 20 + 2] == 0);
    for (size_t x = 3; x < 20; ++x) assert(large[y * 20 + x] == 0xffff);
  }
}
