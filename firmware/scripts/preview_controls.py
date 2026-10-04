"""Render the actual home/adjustment panels with desktop LVGL, without a device.

Requires GCC/G++ and Pillow. Reuses LVGL objects from preview_usage.py when present.
"""
from pathlib import Path
import concurrent.futures
import hashlib
import os
import shutil
import subprocess
from PIL import Image

root = Path(__file__).resolve().parents[2]
build = root / "out/touch-controls-preview"
build.mkdir(parents=True, exist_ok=True)
lvgl = root / "firmware/.pio/libdeps/viewe_uedx48480040e_wb_a/lvgl"
gcc, cxx = shutil.which("gcc"), shutil.which("g++")
if not gcc or not cxx:
    raise SystemExit("GCC and G++ are required for the LVGL preview")
(build / "Arduino.h").write_text('''#pragma once
#include <cstdint>
#include <cstring>
#include <string>
#include <algorithm>
using String = std::string;
using std::min;
template<class T> T constrain(T v, T lo, T hi) { return std::max(lo, std::min(v, hi)); }
uint32_t millis();
struct NativeSerial { template<class... T> void printf(const char *, T...) {} };
inline NativeSerial Serial;
''', encoding="utf-8")
(build / "Preferences.h").write_text('''#pragma once
class Preferences {
 public:
  bool begin(const char *, bool = false) { return true; }
  void end() {}
  int getInt(const char *, int value) { return value; }
  uint16_t getUShort(const char *, uint16_t value) { return value; }
  void putInt(const char *, int) {}
  void putUShort(const char *, uint16_t) {}
};
''', encoding="utf-8")
(build / "WiFi.h").write_text("#pragma once\n", encoding="utf-8")
(build / "esp_heap_caps.h").write_text('''#pragma once
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
inline void *heap_caps_calloc(size_t n, size_t size, int) { return calloc(n, size); }
''', encoding="utf-8")

(build / "preview.cpp").write_text(r'''
#include <lvgl.h>
#include <cassert>
#include <cstdio>
#include <ctime>
#include <vector>
#include "features/display_control/service.h"
#include "features/wallpaper/wallpaper.h"
uint32_t clock_ms = 100000;
uint32_t millis() { return clock_ms; }
DisplayControl::RemoteState fixture;
struct Command { std::string control; int value; bool final_value; };
std::vector<Command> commands;
uint8_t applied_backlight = 0;
namespace Board { void setBacklight(uint8_t value) { applied_backlight = value; } }
namespace DisplayControl {
RemoteState getRemoteState() { return fixture; }
bool queueNumericControl(const char *control, int value, bool final_value) {
  commands.push_back({control, value, final_value}); return true;
}
bool queueBooleanControl(const char *, bool) { return true; }
bool queueStringControl(const char *, const char *) { return true; }
bool queueMusicControl(const char *, uint32_t) { return true; }
void copyMusicArtwork(uint8_t *, size_t) {}
void selectUsageProvider(uint8_t) {}
void requestUsageSync() {}
}
namespace Wallpaper {
void createView(lv_obj_t *, lv_event_cb_t) {}
void show() {}
void hide() {}
bool active() { return false; }
void refresh() {}
}
static tm *native_localtime(const time_t *t, tm *result) { *result = *std::localtime(t); return result; }
#define localtime_r native_localtime
// Include production code so the preview can open the same gesture-driven panels.
#include "features/display_control/screen.cpp"
lv_color_t framebuffer[480 * 480], draw_pixels[480 * 48];
void flush(lv_disp_drv_t *driver, const lv_area_t *area, lv_color_t *pixels) {
  for (int y = area->y1; y <= area->y2; ++y) for (int x = area->x1; x <= area->x2; ++x)
    framebuffer[y * 480 + x] = *pixels++;
  lv_disp_flush_ready(driver);
}
void advance(uint32_t duration) {
  while (duration) {
    const uint32_t step = std::min(duration, 20u);
    duration -= step; clock_ms += step; lv_tick_inc(step); lv_timer_handler();
  }
}
void capture(const char *name) {
  lv_obj_update_layout(lv_scr_act()); lv_refr_now(nullptr);
  FILE *file = fopen(name, "wb"); assert(file);
  fprintf(file, "P6\n480 480\n255\n");
  for (auto pixel : framebuffer) {
    const uint16_t v = pixel.full;
    const uint8_t rgb[] = {uint8_t(((v >> 11) & 31) * 255 / 31), uint8_t(((v >> 5) & 63) * 255 / 63), uint8_t((v & 31) * 255 / 31)};
    fwrite(rgb, 1, 3, file);
  }
  fclose(file);
}
void assertBounds(lv_obj_t *object) {
  lv_area_t a, p; lv_obj_get_coords(object, &a); lv_obj_get_coords(lv_obj_get_parent(object), &p);
  assert(a.x1 >= p.x1 && a.x2 <= p.x2 && a.y1 >= p.y1 && a.y2 <= p.y2);
}
int main() {
  lv_init();
  lv_disp_draw_buf_t draw; lv_disp_draw_buf_init(&draw, draw_pixels, nullptr, 480 * 48);
  lv_disp_drv_t driver; lv_disp_drv_init(&driver);
  driver.hor_res = 480; driver.ver_res = 480; driver.draw_buf = &draw; driver.flush_cb = flush;
  lv_disp_drv_register(&driver);
  lv_obj_set_style_bg_color(lv_scr_act(), lv_color_hex(0x000000), 0);
  lv_obj_set_style_pad_all(lv_scr_act(), 0, 0);
  fixture.ready = fixture.online = fixture.music_available = fixture.music_playing = true;
  strcpy(fixture.message, "DDC connected");
  fixture.brightness = 72; fixture.volume = 64;
  fixture.music_duration_ms = 240000; fixture.music_position_ms = 45000;
  strcpy(fixture.music_title, "星夜"); strcpy(fixture.music_artist, "YangCi Demo");
  strcpy(fixture.music_lyric_previous, "星光落在窗前");
  strcpy(fixture.music_lyric_current, "晚风轻轻掠过");
  strcpy(fixture.music_lyric_next, "把今天唱成一首歌");
  fixture.music_artwork_accent = 0x80BFEA;
  using namespace DisplayControl;
  showScreen(); refresh(); advance(550);
  // The existing home layout is preserved apart from the native Linux icon.
  capture("touch-home.ppm");
  for (int value : {0, 100}) {
    fixture.brightness = fixture.volume = value; ++fixture.revision; refresh(); advance(120);
    assert(lv_slider_get_value(brightness_slider) == value);
    capture(value ? "touch-home-full.ppm" : "touch-home-zero.ppm");
  }
  fixture.brightness = 72; fixture.volume = 64; ++fixture.revision; refresh();
  showBacklightPanel(); advance(210); capture("touch-backlight.ppm");
  lv_slider_set_value(backlight_slider, 5, LV_ANIM_OFF);
  lv_event_send(backlight_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  assert(applied_backlight == 13);
  lv_slider_set_value(backlight_slider, 100, LV_ANIM_OFF);
  lv_event_send(backlight_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  assert(applied_backlight == 255); assertBounds(backlight_value);
  closeBacklightPanel(nullptr); advance(40); showBacklightPanel(); advance(210);
  assert(!lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN));
  hideBacklightPanel(); assert(lv_obj_has_flag(backlight_panel, LV_OBJ_FLAG_HIDDEN));
  showMusicView(nullptr); animateAdjustmentPanel(music_volume_panel, true);
  for (int index = 0; index < 9; ++index) {
    char name[64]; snprintf(name, sizeof(name), "motion-volume-%02d.ppm", index);
    capture(name); advance(33);
  }
  assertBounds(music_volume_value); capture("touch-music-volume.ppm");
  commands.clear();
  lv_event_send(music_volume_slider, LV_EVENT_PRESSED, nullptr);
  lv_slider_set_value(music_volume_slider, 37, LV_ANIM_OFF);
  lv_event_send(music_volume_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  assert(lv_slider_get_value(volume_slider) == 37);
  assert(!strcmp(lv_label_get_text(music_volume_value), "37%"));
  assert(commands.size() == 1 && commands.back().control == "volume" && !commands.back().final_value);
  // A pending desktop value must not pull the knob away during a drag.
  fixture.volume = 64; ++fixture.revision; refresh();
  assert(lv_slider_get_value(music_volume_slider) == 37);
  lv_event_send(music_volume_slider, LV_EVENT_RELEASED, nullptr);
  assert(commands.size() == 2 && commands.back().value == 37 && commands.back().final_value);
  fixture.volume = 37; ++fixture.revision; refresh(); advance(150);
  for (int value : {0, 100}) {
    fixture.volume = value; ++fixture.revision; refresh(); advance(120);
    assertBounds(music_volume_value);
    capture(value ? "touch-music-volume-full.ppm" : "touch-music-volume-zero.ppm");
  }
  // Both music layouts share the same panel; exiting cancels its motion.
  showImmersiveLyrics(nullptr); animateAdjustmentPanel(music_volume_panel, true);
  advance(210); capture("touch-immersive-volume.ppm");
  hideMusicVolume(); assert(lv_obj_has_flag(music_volume_panel, LV_OBJ_FLAG_HIDDEN));
  animateAdjustmentPanel(music_volume_panel, true); advance(60); hideMusicView(nullptr); advance(300);
  assert(lv_obj_has_flag(music_volume_panel, LV_OBJ_FLAG_HIDDEN));
  assert(lv_obj_get_style_translate_y(music_volume_panel, 0) == 0);
  // Brightness preview and final commit retain their existing timing behavior.
  commands.clear(); lv_event_send(brightness_slider, LV_EVENT_PRESSED, nullptr);
  lv_slider_set_value(brightness_slider, 81, LV_ANIM_OFF);
  lv_event_send(brightness_slider, LV_EVENT_VALUE_CHANGED, nullptr);
  lv_event_send(brightness_slider, LV_EVENT_RELEASED, nullptr);
  assert(commands.size() == 2 && commands.back().control == "brightness" && commands.back().value == 81 && commands.back().final_value);
  puts("Actual LVGL controls preview passed: bounds, backlight limits, volume synchronization, final commits and animation interruption.");
}
''', encoding="utf-8")

flags = ["-O1", "-DLV_CONF_SKIP", "-DLV_COLOR_DEPTH=16", "-DLV_COLOR_16_SWAP=0", "-DLV_MEM_CUSTOM=1", "-DLV_FONT_FMT_TXT_LARGE=1", "-DLV_USE_FONT_COMPRESSED=1"]
flags += [f"-DLV_FONT_MONTSERRAT_{size}=1" for size in [14, 16, 18, 22, 28, 36, 48]]
flags += ["-I", str(lvgl), "-I", str(build), "-I", str(root / "firmware/src")]
base = list((lvgl / "src").rglob("*.c"))
base += [root / "firmware/src/ui/assets" / name for name in [
    "azoria_font_zh_16.c", "azoria_font_zh_28.c", "azoria_font_latin_16.c", "azoria_font_latin_28.c", "azoria_font_din_condensed_48.c", "azoria_font_usage_80.c", "azoria_font_usage_110.c"]]
extra = [root / "firmware/src/ui/assets" / name for name in ["azoria_font_din_condensed_16.c", "azoria_font_music_38.c", "icons.c"]]
extra += [root / "firmware/src/ui/image.cpp", root / "firmware/src/ui/display_badge.cpp", root / "firmware/src/features/display_control/usage_view.cpp", build / "preview.cpp"]

def compile_one(pair):
    index, source = pair
    if index < len(base):
        cached = root / "out/touch-usage-preview" / f"part-{index}.o"
        if cached.exists() and cached.stat().st_mtime >= source.stat().st_mtime:
            return str(cached)
    key = hashlib.sha256(str(source).encode()).hexdigest()[:12]
    target = build / f"{key}.o"
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime or source.suffix == ".cpp":
        command = [cxx if source.suffix == ".cpp" else gcc] + flags
        if source.suffix == ".cpp": command += ["-std=c++17"]
        result = subprocess.run(command + ["-c", str(source), "-o", str(target)], capture_output=True, text=True)
        if result.returncode: raise RuntimeError(result.stderr)
    return str(target)

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    objects = list(pool.map(compile_one, enumerate(base + extra)))
(build / "objects.rsp").write_text("\n".join('"' + name.replace("\\", "/") + '"' for name in objects), encoding="utf-8")
executable = build / ("preview.exe" if os.name == "nt" else "preview")
subprocess.run([cxx, "@" + str(build / "objects.rsp"), "-o", str(executable), "-lm"], check=True)
subprocess.run([str(executable)], cwd=build, check=True)
for ppm in build.glob("*.ppm"):
    with Image.open(ppm) as image: image.save(ppm.with_suffix(".png"))
overview = Image.new("RGB", (1440, 480))
for index, name in enumerate(["touch-home", "touch-backlight", "touch-music-volume"]):
    with Image.open(build / f"{name}.png") as image: overview.paste(image, (index * 480, 0))
overview.save(build / "touch-controls-overview.png")
frames = [Image.open(png).convert("RGB") for png in sorted(build.glob("motion-volume-*.png"))]
frames[0].save(build / "motion-volume.gif", save_all=True, append_images=frames[1:], duration=[33] * (len(frames) - 1) + [1000], loop=0)
print(f"Actual 480x480 LVGL previews: {build}")
