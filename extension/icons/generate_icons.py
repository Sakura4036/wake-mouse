#!/usr/bin/env python3
"""Generate the extension's PNG icons without any third-party libraries.

Draws a rounded green tile with a white double-chevron (a "scroll down" hint).
Run: python3 generate_icons.py
"""
import math
import struct
import zlib


def lerp(a, b, t):
    return a + (b - a) * t


def dist_point_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def rounded_alpha(x, y, n, radius):
    """Coverage (0..1) for a rounded-square mask with anti-aliasing."""
    r = radius
    # nearest point clamped inside the rounded rect's inner box
    cx = min(max(x, r), n - 1 - r)
    cy = min(max(y, r), n - 1 - r)
    d = math.hypot(x - cx, y - cy)
    return max(0.0, min(1.0, r - d + 0.5))


def make_icon(n):
    radius = max(2, int(n * 0.22))
    thickness = max(1.4, n * 0.085)

    # Two stacked chevrons (down arrows), centered.
    cx = n / 2.0
    # chevron geometry as fractions of size
    half_w = n * 0.26
    v_drop = n * 0.16
    gap = n * 0.20
    top1 = n * 0.30
    chevrons = []
    for k in range(2):
        ty = top1 + k * gap
        chevrons.append(
            (
                (cx - half_w, ty),
                (cx, ty + v_drop),
                (cx + half_w, ty),
            )
        )

    px = bytearray()
    for y in range(n):
        px.append(0)  # PNG filter byte (none) per scanline
        for x in range(n):
            # background gradient (top-left lighter green -> bottom-right darker)
            t = (x + y) / (2.0 * n)
            br = int(lerp(0x34, 0x15, t))
            bg = int(lerp(0xD3, 0x9A, t))
            bb = int(lerp(0x99, 0x3F, t))
            r, g, b = br, bg, bb

            # chevron coverage (white)
            best = 1e9
            for (a, mid, c) in chevrons:
                d1 = dist_point_seg(x + 0.5, y + 0.5, a[0], a[1], mid[0], mid[1])
                d2 = dist_point_seg(x + 0.5, y + 0.5, mid[0], mid[1], c[0], c[1])
                best = min(best, d1, d2)
            cov = max(0.0, min(1.0, (thickness - best) + 0.5))
            if cov > 0:
                r = int(lerp(r, 0xFF, cov))
                g = int(lerp(g, 0xFF, cov))
                b = int(lerp(b, 0xFF, cov))

            a = int(round(rounded_alpha(x, y, n, radius) * 255))
            px.extend((r, g, b, a))

    return png_bytes(n, n, bytes(px))


def png_bytes(width, height, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


if __name__ == "__main__":
    for size in (16, 32, 48, 128):
        data = make_icon(size)
        with open(f"icon{size}.png", "wb") as f:
            f.write(data)
        print(f"wrote icon{size}.png ({len(data)} bytes)")
