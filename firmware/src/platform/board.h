#pragma once

#include <stdint.h>

namespace Board {

using RefreshFinishCallback = bool (*)(void *user_data);

enum class TouchEvent : uint8_t {
  PressDown = 0,
  LiftUp = 1,
  Contact = 2,
  NoEvent = 3,
};

struct TouchPoint {
  uint16_t x;
  uint16_t y;
  int16_t strength;
  TouchEvent event;
};

struct TouchSnapshot {
  bool valid;
  int status_result;
  int points_result;
  uint8_t status;
  uint8_t raw[12];
  int count;
};

bool beginDisplay();
bool beginTouch();
bool begin();
// GPIO42 is shared with TF-card MOSI. Call before the SPI bus is initialized.
void flashStatusLed();
// Send an off frame and release the shared pin. Call only with TF SPI released.
void clearStatusLed();
// Returns the number of valid points, 0 for a successful no-touch read, and
// -1 for an I2C/protocol/argument error.
int readTouches(TouchPoint *points, int max_points);
bool readTouch(uint16_t &x, uint16_t &y);
void printTouchDiagnostics();
bool readTouchSnapshot(TouchSnapshot &snapshot);
void printTouchSnapshot(const TouchSnapshot &snapshot);
void setBacklight(uint8_t value);
bool setRotation(uint16_t degrees);
uint16_t rotation();
uint16_t currentFrameBufferRotation();
void prepareFrameBufferForDisplay(void *buffer);
void restoreFrameBufferAfterDisplay(void *buffer);
void commitFrameBufferForDisplay();
void copyRotatedArea(const void *source, void *destination,
                     int16_t x1, int16_t y1, int16_t x2, int16_t y2);
void *frameBuffer(uint8_t index);
void *currentFrameBuffer();
bool switchFrameBuffer(void *buffer);
bool restartRgbScan();
bool attachRefreshFinishCallback(RefreshFinishCallback callback, void *user_data);

}  // namespace Board
