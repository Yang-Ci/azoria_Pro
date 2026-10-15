Import("env")


def optimize_hot_path(env, node):
    # Keep size optimization for the full application. Only pixel drawing and
    # decoding loops get O3; whole-program speed optimization exceeds flash.
    flags = [flag for flag in env["CCFLAGS"] if str(flag) not in
             ("-Os", "-O0", "-O1", "-O2", "-O3", "-Og")]
    return env.Object(node, CCFLAGS=flags + ["-O3"])


for source in [
    "*/JPEGDEC/src/JPEGDEC.cpp",
    "*/lvgl/src/draw/sw/lv_draw_sw_blend.c",
    "*/lvgl/src/draw/sw/lv_draw_sw_rect.c",
    "*/lvgl/src/draw/sw/lv_draw_sw_letter.c",
    "*/lvgl/src/draw/lv_draw_mask.c",
    "*/lvgl/src/draw/lv_draw_label.c",
    "*/lvgl/src/font/lv_font_fmt_txt.c",
    "*/lvgl/src/misc/lv_color.c",
    "*/lvgl/src/misc/lv_mem.c",
]:
    env.AddBuildMiddleware(optimize_hot_path, source)
