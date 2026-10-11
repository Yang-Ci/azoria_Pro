#pragma once

#include "platform/board.h"

// Reject isolated reports without requiring a swipe to stop moving first.
class TouchContactFilter {
 public:
  void reset() { pressed_ = false; press_samples_ = 0; release_samples_ = 0; }
  bool update(int count, const Board::TouchPoint &point) {
    if (count > 0) {
      point_ = point;
      release_samples_ = 0;
      if (!pressed_ && ++press_samples_ < 2) return false;
      pressed_ = true;
      press_samples_ = 0;
      return true;
    }
    press_samples_ = 0;
    if (pressed_ && ++release_samples_ < 3) return true;
    reset();
    return false;
  }
  const Board::TouchPoint &point() const { return point_; }

 private:
  Board::TouchPoint point_{};
  uint8_t press_samples_ = 0;
  uint8_t release_samples_ = 0;
  bool pressed_ = false;
};
