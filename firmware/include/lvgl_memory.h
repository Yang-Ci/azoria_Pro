#pragma once

#include <stddef.h>
#include <esp_heap_caps.h>

// The three UI views outgrow LVGL's default 48 KiB arena. Keep their objects and
// rendering scratch buffers in the board's 8 MiB PSRAM, preserving internal RAM
// for RGB DMA, Wi-Fi and Bluetooth. Allocation failures retain realloc's input.
static inline void *azoria_lvgl_alloc(size_t size) {
  void *result = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  return result ? result : heap_caps_malloc(size, MALLOC_CAP_8BIT);
}

static inline void *azoria_lvgl_realloc(void *pointer, size_t size) {
  void *result = heap_caps_realloc(pointer, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (result || !size) return result;
  return heap_caps_realloc(pointer, size, MALLOC_CAP_8BIT);
}

static inline void azoria_lvgl_free(void *pointer) { heap_caps_free(pointer); }
