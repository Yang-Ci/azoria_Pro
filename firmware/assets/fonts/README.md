# Music wordmark

`Lobster-Regular.ttf` comes from the Google Fonts Lobster family and is licensed
under SIL OFL 1.1; see `OFL-Lobster.txt`. The generated `azoria_font_music_38`
contains only the five characters in `Music`, at 38 px with 4-bit antialiasing.
Its `s` uses the source font's two-curve `S`, scaled to 72% while retaining the
lowercase advance and baseline, so the wordmark does not look like it has a
missing stroke. The temporary derivative is named `Azoria Music` in accordance
with the original font's reserved family name; the other glyphs are unchanged.

Regenerate from the repository root:

```powershell
python -m pip install fonttools
python firmware/scripts/generate_music_font.py
```

Source: https://github.com/google/fonts/tree/main/ofl/lobster

# Touch quota numerals

`RobotoCondensed/RobotoCondensed.ttf` comes from Google Fonts and is licensed
under SIL OFL 1.1; its license is retained alongside the source font. The Touch
usage view uses two small subsets at 80 and 110 px, instantiated at weight 700.
Regenerate with `python firmware/scripts/generate_usage_font.py` (requires
fonttools and Node.js / lv_font_conv). Generated C sources contain their license
notice and fall back to Montserrat for scientific notation.

Source: https://github.com/google/fonts/tree/main/ofl/robotocondensed
