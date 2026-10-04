"""Compile the actual Touch usage view against LVGL 8 and render/test it on a PC.

Requires a native GCC/G++ compiler and Pillow. Outputs are generated in out/.
No ESP32 hardware, network credentials, or hand-drawn UI replacements are used.
"""
from pathlib import Path
import argparse
import concurrent.futures
import os
import shutil
import subprocess
from PIL import Image

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("--gcc", default=shutil.which("gcc"))
parser.add_argument("--cxx", default=shutil.which("g++"))
args = parser.parse_args()
if not args.gcc or not args.cxx:
    raise SystemExit("GCC and G++ are required for the LVGL preview")
lvgl = root / "firmware/.pio/libdeps/viewe_uedx48480040e_wb_a/lvgl"
build = root / "out/touch-usage-preview"
build.mkdir(parents=True, exist_ok=True)
(build / "Arduino.h").write_text('''#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <algorithm>
using String = std::string;
using std::min;
uint32_t millis();
''', encoding="utf-8")

(build / "preview.cpp").write_text(r'''
#include <lvgl.h>
#include <cassert>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <cstdint>
#include "features/display_control/usage_view.h"

uint32_t clock_ms = 100000;
uint32_t millis() { return clock_ms; }
DisplayControl::RemoteState fixture;
int selected_provider = -1;
namespace DisplayControl {
void noteInteraction() {}
void requestUsageSync() {}
void selectUsageProvider(uint8_t index) {
  selected_provider = index;
  fixture.usage.api_available = false;
  strcpy(fixture.usage.api_name, "Loading");
  ++fixture.usage.revision;
}
}
lv_color_t framebuffer[480 * 480];
lv_color_t buffer[480 * 48];
void flush(lv_disp_drv_t *driver, const lv_area_t *area, lv_color_t *pixels) {
  for (int y = area->y1; y <= area->y2; y++) for (int x = area->x1; x <= area->x2; x++) framebuffer[y * 480 + x] = *pixels++;
  lv_disp_flush_ready(driver);
}
lv_obj_t *find(lv_obj_t *parent, const char *value) {
  if (lv_obj_has_flag(parent, LV_OBJ_FLAG_HIDDEN)) return nullptr;
  if (lv_obj_check_type(parent, &lv_label_class) && !strcmp(lv_label_get_text(parent), value)) return parent;
  for (uint32_t i = 0; i < lv_obj_get_child_cnt(parent); i++) {
    lv_obj_t *result = find(lv_obj_get_child(parent, i), value);
    if (result) return result;
  }
  return nullptr;
}
void click(const char *value) {
  auto *label = find(lv_scr_act(), value);
  assert(label);
  lv_event_send(lv_obj_get_parent(label), LV_EVENT_CLICKED, nullptr);
}
void assertContained(lv_obj_t *label) {
  assert(label);
  lv_area_t bounds, container;
  lv_obj_get_coords(label, &bounds);
  lv_obj_get_coords(lv_obj_get_parent(label), &container);
  assert(bounds.x1 >= container.x1 && bounds.x2 <= container.x2);
  assert(bounds.y1 >= container.y1 && bounds.y2 <= container.y2);
}
void advance(uint32_t duration) {
  while (duration) {
    const uint32_t step = duration < 20 ? duration : 20;
    clock_ms += step;
    lv_tick_inc(step);
    lv_timer_handler();
    duration -= step;
  }
}
void refreshFixture() {
  fixture.usage.received_at_ms = clock_ms;
  DisplayControl::UsageView::refresh(fixture);
}
void capture(const char *name) {
  lv_obj_update_layout(lv_scr_act());
  lv_refr_now(nullptr);
  FILE *file = fopen(name, "wb"); assert(file);
  fprintf(file, "P6\n480 480\n255\n");
  for (auto &pixel : framebuffer) {
    const uint16_t v = pixel.full;
    const uint8_t rgb[] = {static_cast<uint8_t>(((v >> 11) & 31) * 255 / 31), static_cast<uint8_t>(((v >> 5) & 63) * 255 / 63), static_cast<uint8_t>((v & 31) * 255 / 31)};
    fwrite(rgb, 1, 3, file);
  }
  fclose(file);
}
void render(const char *name) {
  advance(1000);
  refreshFixture();
  advance(560);
  capture(name);
}
void captureSequence(const char *prefix) {
  for (int index = 0; index < 17; ++index) {
    char name[80]; snprintf(name, sizeof(name), "%s-%02d.ppm", prefix, index);
    capture(name);
    advance(33);
  }
}
int litTicks() {
  auto *label = find(lv_scr_act(), "5 小时额度"); assert(label);
  auto *page = lv_obj_get_parent(label);
  int count = 0;
  for (uint32_t i = 0; i < lv_obj_get_child_cnt(page); ++i) {
    auto *object = lv_obj_get_child(page, i);
    if (lv_obj_check_type(object, &lv_line_class) &&
        lv_obj_get_style_line_color(object, 0).full == lv_color_hex(0x20DFE5).full) ++count;
  }
  return count;
}
int main() {
  lv_init();
  lv_disp_draw_buf_t draw; lv_disp_draw_buf_init(&draw, buffer, nullptr, 480 * 48);
  lv_disp_drv_t driver; lv_disp_drv_init(&driver);
  driver.hor_res = 480; driver.ver_res = 480; driver.draw_buf = &draw; driver.flush_cb = flush;
  lv_disp_drv_register(&driver);
  lv_obj_set_style_bg_color(lv_scr_act(), lv_color_hex(0x000000), 0);
  lv_obj_set_style_pad_all(lv_scr_act(), 0, 0);
  fixture.online = true;
  auto &usage = fixture.usage;
  usage.supported = true; usage.codex_available = true;
  strcpy(usage.codex_plan, "PLUS");
  usage.primary_minutes = 300; usage.primary_remaining = 930;
  usage.primary_resets_at = time(nullptr) + 8040;
  usage.secondary_minutes = 10080; usage.secondary_remaining = 680;
  usage.secondary_resets_at = time(nullptr) + 4 * 86400;
  usage.codex_sampled_at = time(nullptr);
  usage.provider_count = 2; usage.api_available = true;
  strcpy(usage.api_name, "DeepSeek"); strcpy(usage.api_unit, "CNY");
  strcpy(usage.api_remaining, "13024.49"); strcpy(usage.api_compact, "1.30"); strcpy(usage.api_scale, "万");
  strcpy(usage.api_used, "4655.51"); strcpy(usage.api_recent, "0.00"); strcpy(usage.api_requests, "27774");
  usage.api_sampled_at = time(nullptr);
  DisplayControl::UsageView::create(lv_scr_act());
  DisplayControl::UsageView::show();
  refreshFixture();
  assert(find(lv_scr_act(), "93%"));  // Real values appear before decorative motion.
  assert(litTicks() == 0 && lv_anim_count_running() > 0);
  captureSequence("motion-entrance");
  assert(litTicks() == 57 && lv_anim_count_running() == 0);
  ++usage.revision; refreshFixture();  // A heartbeat must not replay the entrance.
  assert(litTicks() == 57 && lv_anim_count_running() == 0);
  render("touch-codex.ppm");
  assert(find(lv_scr_act(), "93%"));
  assertContained(find(lv_scr_act(), "93%"));
  assertContained(find(lv_scr_act(), "68%"));
  strcpy(usage.codex_plan, "pro"); ++usage.revision;
  render("touch-codex-pro.ppm");
  assert(find(lv_scr_act(), "PRO") && find(lv_scr_act(), "周额度") && find(lv_scr_act(), "68%"));
  assert(!find(lv_scr_act(), "93%") && !find(lv_scr_act(), "5 小时额度"));
  assertContained(find(lv_scr_act(), "68%"));
  // Pro retains the finite entrance motion used by Plus.
  DisplayControl::UsageView::hide(); DisplayControl::UsageView::show(); refreshFixture();
  captureSequence("motion-pro-entrance");
  assert(lv_anim_count_running() == 0);
  // Only the weekly window drives Pro, including expiry and its countdown.
  usage.primary_resets_at = time(nullptr) - 60; ++usage.revision;
  render("touch-codex-pro-short-expired.ppm");
  assert(find(lv_scr_act(), "68%") && find(lv_scr_act(), "刚刚同步"));
  assert(!find(lv_scr_act(), "等待新周期数据") && !find(lv_scr_act(), "数据较旧"));
  usage.primary_minutes = 10080; usage.primary_remaining = 725;
  usage.primary_resets_at = time(nullptr) + 4 * 86400;
  usage.secondary_minutes = 0; usage.secondary_remaining = -1; ++usage.revision;
  render("touch-codex-pro-primary-week.ppm");
  assert(find(lv_scr_act(), "72.5%") && !find(lv_scr_act(), "68%"));
  usage.primary_minutes = 300; usage.primary_remaining = 930;
  usage.primary_resets_at = time(nullptr) + 8040; ++usage.revision;
  render("touch-codex-pro-missing-week.ppm");
  assert(find(lv_scr_act(), "--") && find(lv_scr_act(), "等待额度数据"));
  assert(!find(lv_scr_act(), "93%") && !find(lv_scr_act(), "5 小时额度"));
  usage.secondary_minutes = 10080; usage.secondary_remaining = 1000;
  usage.secondary_resets_at = time(nullptr) + 4 * 86400; ++usage.revision;
  render("touch-codex-pro-full.ppm");
  assertContained(find(lv_scr_act(), "100%"));
  assert(!find(lv_scr_act(), "93%"));
  usage.secondary_remaining = 999; ++usage.revision;
  render("touch-codex-pro-decimal.ppm");
  assertContained(find(lv_scr_act(), "99.9%"));
  usage.secondary_resets_at = time(nullptr) - 60; ++usage.revision;
  render("touch-codex-pro-week-expired.ppm");
  assert(find(lv_scr_act(), "等待新周期数据") && find(lv_scr_act(), "数据较旧"));
  usage.codex_available = false; ++usage.revision;
  render("touch-codex-pro-empty.ppm");
  assert(find(lv_scr_act(), "PRO") && find(lv_scr_act(), "周额度") && find(lv_scr_act(), "等待额度数据"));
  usage.codex_available = true; strcpy(usage.codex_plan, "PLUS");
  usage.primary_remaining = 930; usage.secondary_remaining = 680;
  usage.secondary_resets_at = time(nullptr) + 4 * 86400; ++usage.revision;
  render("touch-codex-plus-restored.ppm");
  assert(find(lv_scr_act(), "PLUS") && litTicks() == 57);
  usage.primary_remaining = 750; ++usage.revision; refreshFixture();
  assert(find(lv_scr_act(), "75%") && litTicks() == 57);
  advance(80); assert(litTicks() > 46 && litTicks() < 57);
  usage.primary_remaining = 650; ++usage.revision; refreshFixture();
  assert(find(lv_scr_act(), "65%"));
  captureSequence("motion-quota");
  assert(litTicks() == 40 && lv_anim_count_running() == 0);
  usage.primary_remaining = 1000; usage.secondary_remaining = 1000; usage.revision++;
  render("touch-codex-full.ppm");
  assertContained(find(lv_scr_act(), "100%"));
  usage.primary_remaining = 999; usage.secondary_remaining = 999; usage.revision++;
  render("touch-codex-decimal.ppm");
  assertContained(find(lv_scr_act(), "99.9%"));
  usage.primary_remaining = 105; usage.secondary_remaining = 0; usage.revision++;
  render("touch-codex-low.ppm");
  assertContained(find(lv_scr_act(), "10.5%"));
  assert(find(lv_scr_act(), "0%"));
  usage.codex_available = false; usage.revision++;
  render("touch-codex-empty.ppm");
  assert(find(lv_scr_act(), "等待额度数据"));
  assert(!find(lv_scr_act(), "10.5%"));
  assertContained(find(lv_scr_act(), "在桌面端完成一次 Codex 对话"));
  usage.codex_available = true; usage.primary_remaining = 930; usage.secondary_remaining = 680; usage.revision++;
  // Rapid reversals settle at the final page and leave no unfinished motion.
  click("API"); refreshFixture(); advance(60);
  click("Codex"); refreshFixture(); advance(60);
  click("API"); refreshFixture();
  auto *api_page = lv_obj_get_parent(lv_obj_get_parent(find(lv_scr_act(), "账户余额")));
  assert(lv_obj_get_style_translate_x(api_page, 0) == 24);
  captureSequence("motion-page");
  assert(lv_obj_get_style_translate_x(api_page, 0) == 0);
  assert(lv_obj_get_style_opa(api_page, 0) == LV_OPA_COVER && lv_anim_count_running() == 0);
  render("touch-api.ppm");
  assert(find(lv_scr_act(), "万"));
  assert(!find(lv_scr_act(), "DeepSeek"));
  assert(find(lv_scr_act(), "1/2"));
  assertContained(find(lv_scr_act(), "0.00"));
  assertContained(find(lv_scr_act(), "27774"));
  auto *amount = find(lv_scr_act(), "1.30"); assert(amount && lv_obj_get_width(amount) <= 342);
  auto *balance_button = lv_obj_get_parent(amount);
  lv_obj_add_state(balance_button, LV_STATE_PRESSED); advance(140);
  assert(lv_obj_get_style_color_filter_opa(balance_button, 0) == 30);
  lv_obj_clear_state(balance_button, LV_STATE_PRESSED); advance(140);
  assert(lv_obj_get_style_color_filter_opa(balance_button, 0) == 0);
  click("1.30");
  auto *dialog = lv_obj_get_parent(find(lv_scr_act(), "完整余额"));
  assert(lv_obj_get_style_translate_y(dialog, 0) == 12);
  captureSequence("motion-modal");
  assert(lv_obj_get_style_translate_y(dialog, 0) == 0 && lv_anim_count_running() == 0);
  render("touch-balance-full.ppm");
  assert(find(lv_scr_act(), "13024.49"));
  assert(!find(lv_scr_act(), "DeepSeek"));
  // Closing during opening, and hiding during closing, must cancel cleanly.
  click("关闭"); advance(200); assert(!find(lv_scr_act(), "完整余额"));
  click("1.30"); advance(40); click("关闭"); advance(200);
  assert(!find(lv_scr_act(), "完整余额") && lv_anim_count_running() == 0);
  click("1.30"); advance(40); click("关闭");
  DisplayControl::UsageView::hide(); assert(lv_anim_count_running() == 0);
  advance(300); DisplayControl::UsageView::show(1); refreshFixture();
  assert(!find(lv_scr_act(), "完整余额"));
  click("账户余额");
  assert(selected_provider == 1);
  render("touch-api-loading.ppm");
  assert(!find(lv_scr_act(), "1.30"));
  fixture.online = false; render("touch-offline.ppm");
  assert(find(lv_scr_act(), "离线 · 上次数据"));
  fixture.online = true;
  click("Codex"); usage.primary_resets_at = time(nullptr) - 1; usage.revision++;
  render("touch-cycle-ended.ppm");
  assert(find(lv_scr_act(), "等待新周期数据"));
  assert(find(lv_scr_act(), "93%"));
  assert(lv_anim_count_running() == 0);
  usage.primary_resets_at = time(nullptr) + 8040; ++usage.revision;
  DisplayControl::UsageView::hide(); DisplayControl::UsageView::show(); refreshFixture();
  assert(lv_anim_count_running() > 0);
  advance(80); DisplayControl::UsageView::hide();
  assert(!DisplayControl::UsageView::active() && lv_anim_count_running() == 0);
  printf("LVGL rendering and interactions passed: quota range, decimals, empty/low states, hidden provider names, tabs, full balance, account switch, offline cache, expired quota; animation completion, immediate values, no heartbeat replay, mid-motion updates, rapid page reversals, button feedback, modal interruption, exit cancellation.\n");
}
''', encoding="utf-8")

flags = ["-O1", "-DLV_CONF_SKIP", "-DLV_COLOR_DEPTH=16", "-DLV_COLOR_16_SWAP=0", "-DLV_MEM_CUSTOM=1", "-DLV_FONT_FMT_TXT_LARGE=1", "-DLV_USE_FONT_COMPRESSED=1"]
flags += [f"-DLV_FONT_MONTSERRAT_{size}=1" for size in [14, 16, 18, 22, 28, 36, 48]]
flags += ["-I", str(lvgl), "-I", str(build), "-I", str(root / "firmware/src")]
sources = list((lvgl / "src").rglob("*.c"))
sources += [root / "firmware/src/ui/assets" / name for name in [
    "azoria_font_zh_16.c", "azoria_font_zh_28.c", "azoria_font_latin_16.c", "azoria_font_latin_28.c", "azoria_font_din_condensed_48.c", "azoria_font_usage_80.c", "azoria_font_usage_110.c"]]
sources += [root / "firmware/src/features/display_control/usage_view.cpp", build / "preview.cpp"]

def compile_one(pair):
    index, source = pair
    target = build / f"part-{index}.o"
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime or source.suffix == ".cpp":
        command = [args.cxx if source.suffix == ".cpp" else args.gcc] + flags
        if source.suffix == ".cpp": command += ["-std=c++17"]
        result = subprocess.run(command + ["-c", str(source), "-o", str(target)], capture_output=True, text=True)
        if result.returncode: raise RuntimeError(result.stderr)
    return str(target)

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    objects = list(pool.map(compile_one, enumerate(sources)))
(build / "objects.rsp").write_text("\n".join('"' + name.replace("\\", "/") + '"' for name in objects), encoding="utf-8")
executable = build / ("preview.exe" if os.name == "nt" else "preview")
subprocess.run([args.cxx, "@" + str(build / "objects.rsp"), "-o", str(executable), "-lm"], check=True)
subprocess.run([str(executable)], cwd=build, check=True)
for ppm in build.glob("*.ppm"):
    with Image.open(ppm) as image: image.save(ppm.with_suffix(".png"))
# Check the rendered numeral strokes against each layout's inner arc boundary.
# Leave six pixels before the shortest tick.
for name in ["touch-codex", "touch-codex-full", "touch-codex-decimal", "touch-codex-low",
             "touch-codex-pro", "touch-codex-pro-full", "touch-codex-pro-decimal"]:
    with Image.open(build / f"{name}.png") as image:
        pixels = image.convert("RGB")
        pro = "-pro" in name
        center_y, radius = (260, 145) if pro else (242, 128)
        top, bottom = (185, 280) if pro else (135, 235)
        strokes = [(x, y) for y in range(top, bottom) for x in range(95, 385)
                   if min(pixels.getpixel((x, y))) > 160
                   and pixels.getpixel((x, y))[0] >= pixels.getpixel((x, y))[2]]
        assert strokes, f"No percentage rendered in {name}"
        assert all((x - 240) ** 2 + (y - center_y) ** 2 <= radius ** 2 for x, y in strokes), \
            f"Percentage overlaps the inner arc in {name}"
with Image.open(build / "touch-codex.png") as original, Image.open(build / "touch-codex-plus-restored.png") as restored:
    assert original.tobytes() == restored.tobytes(), "Switching back to Plus changed its layout"
for prefix in ["motion-entrance", "motion-quota", "motion-page", "motion-modal", "motion-pro-entrance"]:
    frames = []
    for png in sorted(build.glob(f"{prefix}-*.png")):
        with Image.open(png) as image: frames.append(image.convert("RGB"))
    frames[0].save(build / f"{prefix}.gif", save_all=True, append_images=frames[1:],
                   duration=[33] * (len(frames) - 1) + [1000], loop=0)
print(f"Actual 480x480 LVGL previews: {build}")
