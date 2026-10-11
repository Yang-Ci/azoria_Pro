#include <cassert>
#include "platform/touch_contact_filter.h"

int main() {
  TouchContactFilter filter;
  Board::TouchPoint first{100, 100, -1, Board::TouchEvent::PressDown};
  Board::TouchPoint moving{180, 100, -1, Board::TouchEvent::Contact};
  assert(!filter.update(1, first));
  assert(filter.update(1, moving));  // A fast swipe starts without a pause.
  assert(filter.point().x == 180);
  assert(filter.update(0, {}));     // A brief report gap preserves dragging.
  assert(filter.update(-1, {}));
  assert(filter.update(1, moving));
  assert(filter.update(0, {}));
  assert(filter.update(0, {}));
  assert(!filter.update(0, {}));
  assert(!filter.update(1, first)); // An isolated noise report isn't a press.
  assert(!filter.update(0, {}));
  assert(!filter.update(1, moving));
  assert(filter.update(1, moving));
  filter.reset();                 // Sleep does not leave a contact held.
  assert(!filter.update(0, {}));
  assert(!filter.update(1, moving));
}
