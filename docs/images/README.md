# UI preview assets

These screenshots render the current application components with demonstration
data. They are not photographs of a connected device or evidence of hardware
validation. Desktop views use the actual React renderer and stylesheet; Touch
views use the actual 480×480 LVGL screen implementation. Dropdown panels are
closed in the documentation screenshots.

The fictional track **星夜 / YangCi Demo**, its sample lyric lines, device status,
and wallpaper synchronization status are preview fixtures. The cover is original
demo artwork, not the official artwork of a music release. Actual playback uses
the artwork returned by the detected player or supported music metadata provider.

## Original demo cover

- File: `azoria-demo-cover.png` (512×512).
- Generated with the built-in image generation tool; then resized for the
  documentation and converted to 64×64 RGB565 for the LVGL preview fixture.
- Prompt:

> Create one original square music demo cover for a local music control app's documentation. A deep midnight-blue sky above a simple dark mountain horizon, one luminous warm white star with a restrained blue glow, subtle faint stars. Elegant atmospheric photographic illustration, strong readable composition even at 64x64 pixels. No lettering, no logos, no borders, no people. This is original placeholder art and must not imitate any existing album cover.

The demo cover is used only by documentation preview fixtures; it does not
replace live player artwork in the application.
