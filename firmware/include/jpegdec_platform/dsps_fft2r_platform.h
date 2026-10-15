#pragma once

#include "sdkconfig.h"

// JPEGDEC 1.8.3 uses ESP-DSP's platform header solely to detect S3 SIMD.
// The firmware excludes the FFT component; expose only that architecture
// capability rather than linking the unused DSP implementation.
#if CONFIG_IDF_TARGET_ESP32S3
#define dsps_fft2r_sc16_aes3_enabled 1
#endif
