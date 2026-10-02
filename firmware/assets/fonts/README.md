# Music wordmark

`Lobster-Regular.ttf` comes from the Google Fonts Lobster family and is licensed
under SIL OFL 1.1; see `OFL-Lobster.txt`. The generated `azoria_font_music_38`
contains only the five characters in `Music`, at 38 px with 4-bit antialiasing.

Regenerate from the repository root:

```powershell
npx --yes lv_font_conv@1.5.3 --size 38 --bpp 4 --format lvgl --font firmware/assets/fonts/Lobster-Regular.ttf --symbols Music --no-kerning --lv-include lvgl.h --lv-font-name azoria_font_music_38 -o firmware/src/ui/assets/azoria_font_music_38.c
```

Source: https://github.com/google/fonts/tree/main/ofl/lobster
