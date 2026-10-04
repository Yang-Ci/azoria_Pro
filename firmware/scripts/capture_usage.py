"""Capture a real Touch framebuffer over its existing local USB diagnostics."""
from pathlib import Path
import argparse
import array
import re
import sys
import time
import serial
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--port", required=True)
parser.add_argument("--page", type=int, choices=[0, 1], help="Open a usage page; omit to capture the current screen")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()

with serial.Serial(args.port, 115200, timeout=0.3) as link:
    if args.page is not None:
        link.write(f"AZORIA_USAGE {args.page}\n".encode("ascii"))
        end = time.monotonic() + 15
        while time.monotonic() < end:
            line = link.readline()
            if b"AZORIA_USAGE_READY" in line:
                break
            if b"AZORIA_USAGE_UNAVAILABLE" in line:
                raise SystemExit("Touch is not configured with a desktop")
        else:
            raise SystemExit("Touch did not confirm its usage view")
    # Allow both display framebuffers to receive the freshly synced state.
    time.sleep(2)
    link.write(b"AZORIA_SCREENSHOT 1\n")
    end = time.monotonic() + 15
    while time.monotonic() < end:
        line = link.readline()
        match = re.search(rb"AZORIA_SCREENSHOT_BEGIN (\d+) (\d+) RGB565LE (\d+)", line)
        if match:
            width, height, length = map(int, match.groups())
            break
    else:
        raise SystemExit("Touch did not start its framebuffer capture")
    if (width, height, length) != (480, 480, 480 * 480 * 2):
        raise SystemExit("Unexpected Touch framebuffer dimensions")
    pixels = bytearray()
    end = time.monotonic() + 20
    while len(pixels) < length and time.monotonic() < end:
        pixels.extend(link.read(length - len(pixels)))
    if len(pixels) != length:
        raise SystemExit("Incomplete Touch framebuffer capture")
    end = time.monotonic() + 5
    while time.monotonic() < end:
        if b"AZORIA_SCREENSHOT_END" in link.readline():
            break
    else:
        raise SystemExit("Touch framebuffer trailer missing")

values = array.array("H", pixels)
if sys.byteorder != "little": values.byteswap()
image = Image.new("RGB", (width, height))
image.putdata([(((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31) for v in values])
args.output.parent.mkdir(parents=True, exist_ok=True)
image.save(args.output)
print(f"Captured real Touch {'current screen' if args.page is None else f'page {args.page}'}: {args.output}")
