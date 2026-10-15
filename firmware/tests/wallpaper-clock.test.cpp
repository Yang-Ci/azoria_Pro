#include <cassert>
#include "features/wallpaper/playback_clock.h"

int main() {
  auto fast = Wallpaper::playbackStep(0, 90, 33, 1000, 1000);
  assert(fast.index == 1 && fast.next_due == 1033 && fast.skipped == 0);
  fast = Wallpaper::playbackStep(88, 90, 33, 1000, 1066);
  assert(fast.index == 1 && fast.next_due == 1099 && fast.skipped == 2 && fast.wrapped);
  auto step = Wallpaper::playbackStep(0, 50, 200, 1000, 1000);
  assert(step.index == 1 && step.next_due == 1200 && step.skipped == 0);
  assert(!step.wrapped);
  step = Wallpaper::playbackStep(0, 50, 200, 1000, 1599);
  assert(step.index == 3 && step.next_due == 1600 && step.skipped == 2);
  step = Wallpaper::playbackStep(49, 50, 200, 1000, 1200);
  assert(step.index == 1 && step.wrapped && step.skipped == 1);
  step = Wallpaper::playbackStep(0, 2, 200, 1000, 3000);
  assert(step.index == 1 && step.wrapped && step.next_due == 3200);
  step = Wallpaper::playbackStep(0, 50, 200, UINT32_MAX - 99, 100);
  assert(step.index == 2 && step.next_due == 300 && step.skipped == 1);
}
