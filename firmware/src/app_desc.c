#include "esp_app_desc.h"
#include "sdkconfig.h"

#ifndef AZORIA_FIRMWARE_VERSION
#define AZORIA_FIRMWARE_VERSION "0.6.1"
#endif

#define AZORIA_PROJECT_NAME "azoria-touch"

const __attribute__((section(".rodata_desc"), used))
esp_app_desc_t esp_app_desc = {
    .magic_word = ESP_APP_DESC_MAGIC_WORD,
    .secure_version = 0,
    .version = AZORIA_FIRMWARE_VERSION,
    .project_name = AZORIA_PROJECT_NAME,
    .time = __TIME__,
    .date = __DATE__,
    .idf_ver = IDF_VER,
    .min_efuse_blk_rev_full = CONFIG_ESP_EFUSE_BLOCK_REV_MIN_FULL,
    .max_efuse_blk_rev_full = CONFIG_ESP_EFUSE_BLOCK_REV_MAX_FULL,
    .mmu_page_size = 31 - __builtin_clz(CONFIG_MMU_PAGE_SIZE),
};
