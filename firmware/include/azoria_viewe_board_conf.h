#pragma once

// Reuse VIEWE's LCD and backlight definition. The bundled generic FT5x06
// initializer aborts Board::begin() on this FT6336U revision, so the controller
// bus is initialized separately with VIEWE's published four-register sequence.
#include "board/supported/viewe/BOARD_VIEWE_UEDX48480040E_WB_A.h"

// GPIO47 is used as the LCD control-data pin during panel initialization and
// as TF-card CS afterwards. Release the LCD 3-wire control bus once the panel
// has received its initialization commands so SDSPI can safely claim it.
#undef ESP_PANEL_BOARD_LCD_FLAGS_ENABLE_IO_MULTIPLEX
#define ESP_PANEL_BOARD_LCD_FLAGS_ENABLE_IO_MULTIPLEX (1)

#undef ESP_PANEL_BOARD_USE_TOUCH
#define ESP_PANEL_BOARD_USE_TOUCH (0)

#undef ESP_PANEL_BOARD_CUSTOM_FILE_VERSION_MAJOR
#undef ESP_PANEL_BOARD_CUSTOM_FILE_VERSION_MINOR
#undef ESP_PANEL_BOARD_CUSTOM_FILE_VERSION_PATCH
#define ESP_PANEL_BOARD_CUSTOM_FILE_VERSION_MAJOR 1
#define ESP_PANEL_BOARD_CUSTOM_FILE_VERSION_MINOR 4
#define ESP_PANEL_BOARD_CUSTOM_FILE_VERSION_PATCH 0
