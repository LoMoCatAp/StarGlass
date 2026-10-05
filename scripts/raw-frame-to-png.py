"""Convert a headerless 4-byte-per-pixel frame dumped by liquidDX11 into a PNG.

The overlay sets WDA_EXCLUDEFROMCAPTURE, so its window cannot be captured by any
screen-capture API.  This reads the raw back-buffer dump produced by
main.cpp::DumpBackBuffer (GLASS_DUMP_FRAME) together with the "<path>.txt"
sidecar it writes ("<width> <height> <dxgi_format>").

Usage:
    python scripts/raw-frame-to-png.py <frame.raw> [--bg 128] [--out foo.png]
"""
import argparse
import os
import sys

from PIL import Image

# DXGI_FORMAT values we expect from a swap-chain back buffer.
DXGI_R8G8B8A8_UNORM = 28
DXGI_B8G8R8A8_UNORM = 87
DXGI_R10G10B10A2_UNORM = 24
DXGI_B8G8R8X8_UNORM = 88


def load_raw(path):
    sidecar = path + ".txt"
    if not os.path.exists(sidecar):
        sys.exit(f"missing sidecar {sidecar!r}; was GLASS_DUMP_FRAME honoured?")
    with open(sidecar) as fh:
        parts = fh.read().split()
    if len(parts) < 3:
        sys.exit(f"malformed sidecar {sidecar!r}: {parts!r}")
    width, height, fmt = int(parts[0]), int(parts[1]), int(parts[2])
    data = open(path, "rb").read()
    expect = width * height * 4
    if len(data) != expect:
        sys.exit(f"size mismatch: got {len(data)} bytes, expected {expect} for {width}x{height}")
    return width, height, fmt, data


def to_image(width, height, fmt, data):
    if fmt == DXGI_B8G8R8A8_UNORM:
        return Image.frombytes("RGBA", (width, height), data, "raw", "BGRA")
    if fmt in (DXGI_R8G8B8A8_UNORM,):
        return Image.frombytes("RGBA", (width, height), data, "raw", "RGBA")
    if fmt == DXGI_B8G8R8X8_UNORM:
        return Image.frombytes("RGB", (width, height), data, "raw", "BGRX").convert("RGBA")
    sys.exit(f"unsupported DXGI format {fmt} (add it to this script)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("--bg", type=int, default=128, help="grey level to composite the alpha over")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    width, height, fmt, data = load_raw(args.raw)
    img = to_image(width, height, fmt, data)
    base = args.out or os.path.splitext(args.raw)[0]

    img.save(base + ".rgba.png")
    flat = Image.new("RGB", img.size, (args.bg, args.bg, args.bg))
    flat.paste(img, (0, 0), img)
    flat.save(base + ".flat.png")
    print(f"{width}x{height} fmt={fmt} -> {base}.rgba.png, {base}.flat.png")


if __name__ == "__main__":
    main()
