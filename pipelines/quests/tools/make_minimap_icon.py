"""Turn the project artwork into the BLP the minimap button wears.

    python3 tools/make_minimap_icon.py assets/icon/spoken-player-512.png \
        ../../addons/Spoken/Textures/MinimapButton.blp

NO FRAME. LibDBIcon draws the icon 17x17 inside "Interface\\Minimap\\MiniMap-TrackingBorder",
so the octagonal gold frame the AddOns-list mark wears would sit inside a second, rounder
frame and read as mud at that size. This crops the frame away and keeps the field and the
glyph, which is why the source is the same 512px render the TGA is made from rather than
artwork of its own: one mark, two crops. LibDBIcon also trims a further 5% off each edge
while the button is not pressed, so nothing that matters may touch the border.

WHY BLP AND NOT TGA. The AddOns-list icon is read by the client's addon list, which takes
either; a texture a frame loads is BLP on every client this ships to.

WHY DXT5 AND NOT A PALETTE. A palettized BLP2 (colour encoding 1) is legal by the format's
own rules and is what vanilla's interface art used, but the Classic beta client -- build
69913, 1.60.1 -- asserts inside its image decoder on one and takes the game down with it
(Engine/Source/Images/StaticImage.cpp). Encoding 2 with preferred format 7, DXT5, is what
all 70 of the other textures in this project are, including the button this one replaces,
so it is the format known to load on every client the addons ship to. A 32x32 icon fits in
2.5 KB of it and the banding a block compressor gives a gradient is invisible at 17 pixels.

NO ffmpeg. The previous version shelled out to it to scale and quantize; decoding one PNG
and box-filtering it is a page of the standard library, and dropping the dependency means
the mark can be rebuilt on a machine that only has Python -- the same reason the result is
committed rather than converted at build time. Re-run it (`make icon`) when the artwork
changes.

ONE PALETTE PER BLOCK, EVERY MIP. Each level is laid out from the full-size render rather
than halved from the level above, so the glyph stays centred on the field at every size
instead of accumulating the rounding error of five successive halvings.
"""
import argparse
import struct
import sys
import zlib

SIZE = 32

# The largest square lying wholly inside the render's dark field starts at 84 of 512, measured
# on its corners; 86 leaves the antialiased edge out too. A looser crop keeps a sliver of
# frame gold in each corner, which at 17 pixels reads as dirt rather than as a frame.
CROP = 86

# The glyphs fill most of that square, and LibDBIcon trims a further 5% off each side while the
# button is idle, inside a round border that hides the corners. The crop is scaled to 24/32 of
# the texture and the rest is field, so the glyph is about 60% of the button, as the minimap
# buttons of other addons are. The colour is the middle stop of the field gradient; the added
# pixels sit against the gradient's darkest corner, where the difference does not show.
INNER = 24
FIELD = (0x16, 0x1C, 0x2E, 0xFF)


# --- the source render ------------------------------------------------------------------

def read_png(path: str) -> tuple[int, int, bytearray]:
    """(width, height, RGBA rows top-down) for an 8-bit non-interlaced PNG."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit(f"{path} is not a PNG")

    header, chunks, pos = None, [], 8
    while pos + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length  # length, type, body, CRC
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            chunks.append(body)
        elif kind == b"IEND":
            break

    width, height, depth, colour, _, _, interlace = header
    if depth != 8 or colour not in (2, 6) or interlace:
        sys.exit(f"{path} is depth {depth}, colour type {colour}, interlace {interlace}; "
                 "this reads 8-bit RGB or RGBA, non-interlaced")

    channels = 3 if colour == 2 else 4
    stride = width * channels
    raw = zlib.decompress(b"".join(chunks))
    if len(raw) != height * (stride + 1):
        sys.exit(f"{path} decompressed to {len(raw)} bytes, expected {height * (stride + 1)}")

    pixels = bytearray(width * height * 4)
    previous, at = bytearray(stride), 0
    for y in range(height):
        row = bytearray(raw[at + 1:at + 1 + stride])
        unfilter(raw[at], row, previous, channels)
        at += stride + 1
        if channels == 4:
            pixels[y * stride:(y + 1) * stride] = row
        else:
            for x in range(width):
                out, src = (y * width + x) * 4, x * 3
                pixels[out:out + 4] = bytes(row[src:src + 3]) + b"\xff"
        previous = row
    return width, height, pixels


def unfilter(kind: int, row: bytearray, previous: bytearray, bpp: int) -> None:
    """Undo one PNG scanline filter in place. Filter 0 (None) needs nothing."""
    if kind == 1:  # Sub
        for i in range(bpp, len(row)):
            row[i] = (row[i] + row[i - bpp]) & 0xFF
    elif kind == 2:  # Up
        for i in range(len(row)):
            row[i] = (row[i] + previous[i]) & 0xFF
    elif kind == 3:  # Average
        for i in range(len(row)):
            left = row[i - bpp] if i >= bpp else 0
            row[i] = (row[i] + ((left + previous[i]) >> 1)) & 0xFF
    elif kind == 4:  # Paeth
        for i in range(len(row)):
            left = row[i - bpp] if i >= bpp else 0
            upleft = previous[i - bpp] if i >= bpp else 0
            up = previous[i]
            pa, pb, pc = abs(up - upleft), abs(left - upleft), abs(left + up - 2 * upleft)
            near = left if pa <= pb and pa <= pc else (up if pb <= pc else upleft)
            row[i] = (row[i] + near) & 0xFF
    elif kind:
        sys.exit(f"unknown PNG filter {kind}")


# --- laying the mark out on a texture ----------------------------------------------------

def resample(src: bytearray, width: int, side: int, dest: int) -> bytearray:
    """The centred square `side` wide, box-filtered down to `dest` square, RGBA.

    Colour is averaged weighted by alpha so that a transparent pixel cannot drag the edge
    of the glyph toward whatever colour happens to sit underneath it. The crop is interior
    to the field and so wholly opaque in practice, which makes this a formality -- but the
    artwork is free to change, and a straight average would fail quietly when it does.
    """
    out = bytearray(dest * dest * 4)
    for j in range(dest):
        y0, y1 = CROP + side * j // dest, CROP + side * (j + 1) // dest
        y1 = max(y1, y0 + 1)
        for i in range(dest):
            x0, x1 = CROP + side * i // dest, CROP + side * (i + 1) // dest
            x1 = max(x1, x0 + 1)

            r = g = b = alpha = count = 0
            for y in range(y0, y1):
                row = y * width * 4
                for x in range(x0, x1):
                    at = row + x * 4
                    a = src[at + 3]
                    r += src[at] * a
                    g += src[at + 1] * a
                    b += src[at + 2] * a
                    alpha += a
                    count += 1

            at = (j * dest + i) * 4
            if alpha:
                out[at], out[at + 1], out[at + 2] = r // alpha, g // alpha, b // alpha
            out[at + 3] = alpha // count
    return out


def layout(src: bytearray, width: int, size: int) -> bytearray:
    """The mark on a `size` square of field, as RGBA."""
    inner = max(1, round(size * INNER / SIZE))
    offset = (size - inner) // 2
    mark = resample(src, width, width - 2 * CROP, inner)

    out = bytearray(bytes(FIELD) * (size * size))
    for j in range(inner):
        for i in range(inner):
            src_at = (j * inner + i) * 4
            out_at = ((j + offset) * size + (i + offset)) * 4
            out[out_at:out_at + 4] = mark[src_at:src_at + 4]
    return out


# --- DXT5 --------------------------------------------------------------------------------

def to565(r: int, g: int, b: int) -> int:
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def from565(v: int) -> tuple[int, int, int]:
    r, g, b = (v >> 11) & 0x1F, (v >> 5) & 0x3F, v & 0x1F
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


def alpha_block(block: list[tuple]) -> bytes:
    """Two endpoints and sixteen 3-bit indices, the eight-value (a0 > a1) mode."""
    values = [p[3] for p in block]
    high, low = max(values), min(values)
    if high == low:  # flat: every index may stay zero
        return bytes([high, low]) + bytes(6)

    table = [high, low] + [((7 - k) * high + k * low) // 7 for k in range(1, 7)]
    bits = 0
    for n, v in enumerate(values):
        bits |= min(range(8), key=lambda k: abs(table[k] - v)) << (3 * n)
    return bytes([high, low]) + bits.to_bytes(6, "little")


def colour_block(block: list[tuple]) -> bytes:
    """Two RGB565 endpoints and sixteen 2-bit indices.

    The endpoints are the two pixels furthest apart along the block's longest axis rather
    than the corners of its bounding box: corners are colours that need not occur, and on a
    gradient that costs a visible step. DXT5 always interpolates four colours, but the
    endpoints are ordered high-first anyway, which is what DXT1's rules would demand.
    """
    colours = [p[:3] for p in block]
    low = [min(c[i] for c in colours) for i in range(3)]
    high = [max(c[i] for c in colours) for i in range(3)]
    axis = [high[i] - low[i] for i in range(3)]

    if not any(axis):  # flat block
        flat = to565(*colours[0])
        return struct.pack("<HHI", flat, flat, 0)

    reach = [sum(a * c for a, c in zip(axis, colour)) for colour in colours]
    first = to565(*colours[reach.index(max(reach))])
    second = to565(*colours[reach.index(min(reach))])
    if first < second:
        first, second = second, first

    c0, c1 = from565(first), from565(second)
    table = [c0, c1,
             tuple((2 * c0[i] + c1[i]) // 3 for i in range(3)),
             tuple((c0[i] + 2 * c1[i]) // 3 for i in range(3))]

    bits = 0
    for n, colour in enumerate(colours):
        nearest = min(range(4), key=lambda k: sum((table[k][i] - colour[i]) ** 2
                                                  for i in range(3)))
        bits |= nearest << (2 * n)
    return struct.pack("<HHI", first, second, bits)


def dxt5(pixels: bytearray, size: int) -> bytes:
    """One mip level. Levels below 4 square still cost a whole block, clamped at the edge."""
    across = max(1, (size + 3) // 4)
    out = []
    for by in range(across):
        for bx in range(across):
            block = []
            for j in range(4):
                y = min(by * 4 + j, size - 1)
                for i in range(4):
                    x = min(bx * 4 + i, size - 1)
                    at = (y * size + x) * 4
                    block.append(tuple(pixels[at:at + 4]))
            out.append(alpha_block(block) + colour_block(block))
    return b"".join(out)


def blp2(levels: list[bytes], size: int) -> bytes:
    """BLP2, colour encoding 2 (DXT), preferred format 7 (DXT5), 8-bit alpha.

    The 1 KB palette is written as zeroes: DXT levels do not read it, but the mip tables are
    at fixed offsets behind it and the client reads the header as a struct of a fixed 1,172
    bytes -- which is exactly where every other BLP in this project puts its first level.
    """
    header_size = 20 + 16 * 4 + 16 * 4 + 256 * 4
    offsets, sizes = [0] * 16, [0] * 16
    cursor = header_size
    for i, level in enumerate(levels):
        offsets[i], sizes[i] = cursor, len(level)
        cursor += len(level)

    header = struct.pack("<4sI4BII", b"BLP2", 1, 2, 8, 7, 1 if len(levels) > 1 else 0,
                         size, size)
    return (header + struct.pack("<16I", *offsets) + struct.pack("<16I", *sizes)
            + bytes(256 * 4) + b"".join(levels))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("out")
    parser.add_argument("--size", type=int, default=SIZE,
                        help="square edge in pixels, a power of two (default: 32)")
    args = parser.parse_args()

    if args.size & (args.size - 1):
        sys.exit(f"{args.size} is not a power of two; the client will not load it")

    width, height, source = read_png(args.source)
    if width != height:
        sys.exit(f"{args.source} is {width}x{height}; the mark is square")
    if width <= 2 * CROP:
        sys.exit(f"{args.source} is {width} wide; the {CROP}px crop would leave nothing")

    levels, size = [], args.size
    while size >= 1:
        levels.append(dxt5(layout(source, width, size), size))
        size //= 2

    with open(args.out, "wb") as f:
        f.write(blp2(levels, args.size))
    print(f"wrote {args.out} ({args.size}x{args.size}, DXT5, {len(levels)} mip levels)")
