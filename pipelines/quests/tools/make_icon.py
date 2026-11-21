"""Turn the project artwork into the TGA the client shows beside an addon's name.

    python tools/make_icon.py assets/icon/spoken-quests-512.png assets/icon/spoken-quests.tga

WHY NOT JUST ffmpeg. Its targa encoder writes RLE (image type 10) and ignores
-compression_algo raw on the versions to hand; the client wants an uncompressed image. So
ffmpeg only decodes to raw BGRA here and the 18-byte header is written below, which is also
the whole of the TGA format that matters for a 64x64 icon.

BOTTOM-UP, 32-bit. The descriptor byte says which corner row zero is, and bottom-up is the
convention every WoW addon icon follows; a top-down file loads upside down rather than
failing, which is the kind of bug that survives review.

Committed as a TGA rather than converted at build time so that building an addon needs no
ffmpeg - the same reason the corpus is committed. Re-run it (`make quests-icon`) when the
PNGs in assets/icon/ are replaced.

ONE ICON PER ADDON. The player carries the play triangle, Spoken Quests and its five sound
packs the exclamation mark; they sit next to each other in the AddOns list, so the same
artwork on both would say they are the same thing.
"""
import argparse
import struct
import subprocess
import sys

SIZE = 64


def raw_bgra(source: str, size: int = SIZE) -> bytes:
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", source,
         # Lanczos keeps the frame and the mark crisp at 64 pixels; the default bicubic blurs them.
         "-vf", f"scale={size}:{size}:flags=lanczos", "-pix_fmt", "bgra", "-f", "rawvideo", "-"],
        check=True, capture_output=True)
    expected = size * size * 4
    if len(result.stdout) != expected:
        sys.exit(f"expected {expected} bytes of BGRA, got {len(result.stdout)}")
    return result.stdout


def tga(pixels: bytes, size: int = SIZE) -> bytes:
    # 0 id length, 0 no colour map, 2 uncompressed true-colour, then an empty colour map spec.
    header = struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, size, size, 32, 0x08)
    rows = [pixels[y * size * 4:(y + 1) * size * 4] for y in range(size)]
    return header + b"".join(reversed(rows))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("out")
    parser.add_argument("--size", type=int, default=SIZE,
                        help="square edge in pixels, a power of two (default: 64)")
    args = parser.parse_args()

    if args.size & (args.size - 1):
        sys.exit(f"{args.size} is not a power of two; the client will not load it")

    with open(args.out, "wb") as f:
        f.write(tga(raw_bgra(args.source, args.size), args.size))
    print(f"wrote {args.out} ({args.size}x{args.size}, uncompressed 32-bit)")
