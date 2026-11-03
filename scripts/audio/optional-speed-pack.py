#!/usr/bin/env python3
"""Build an optional 1.25x, 1.5x or 2x audio pack from a shipped Spoken audio ZIP.

The output contains only audio and a TOC. It does not replace the source pack.
Each output addon mirrors one source addon's OGG and MP3 paths so Spoken can
choose a faster copy without changing the source pack or its lookup tables.
"""

import argparse
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
from zipfile import ZipFile, ZIP_STORED


RATES = {"1.25": ("125", "1.25"), "1.5": ("15", "1.5"), "2": ("20", "2")}


def metadata(toc: bytes, key: str) -> str:
    text = toc.decode("utf-8-sig")
    match = re.search(rf"^## {re.escape(key)}: (.+)$", text, re.MULTILINE)
    if not match:
        raise ValueError(f"Source TOC has no {key}")
    return match.group(1).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="official Spoken audio ZIP")
    parser.add_argument("--speed", choices=RATES, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve() or args.output.exists():
        parser.error("output must be a new ZIP, separate from the source")
    if not shutil.which("ffmpeg"):
        parser.error("ffmpeg is required, with libvorbis and libmp3lame encoders")

    suffix, rate = RATES[args.speed]
    with ZipFile(args.source) as source:
        entries = [item for item in source.infolist() if not item.is_dir()]
        audio = []
        tocs = {}
        for item in entries:
            path = PurePosixPath(item.filename)
            if len(path.parts) < 2 or any(part in (".", "..") for part in path.parts):
                raise ValueError(f"Unsafe path in source ZIP: {item.filename}")
            if not re.fullmatch(r"[A-Za-z0-9_]+", path.parts[0]) or "\\" in item.filename:
                raise ValueError(f"Unsafe addon folder in source ZIP: {item.filename}")
            if path.suffix.lower() in (".ogg", ".mp3"):
                audio.append((item, path))
            elif len(path.parts) == 2 and path.suffix.lower() == ".toc" and path.stem == path.parts[0]:
                tocs[path.parts[0]] = source.read(item)
        if not audio:
            raise ValueError("Source ZIP has no OGG or MP3 files")
        packs = {path.parts[0] for _, path in audio}
        if packs - tocs.keys():
            raise ValueError(f"Missing source TOC for {sorted(packs - tocs.keys())}")

        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="spoken-speed-") as temporary:
            temporary = Path(temporary)
            with ZipFile(args.output, "w", compression=ZIP_STORED, allowZip64=True) as output:
                for pack in sorted(packs):
                    optional = f"SpokenSpeed{suffix}_{pack}"
                    toc = tocs[pack]
                    header = (
                        f"## Interface: {metadata(toc, 'Interface')}\n"
                        f"## Title: Spoken {rate}x audio for {pack}\n"
                        f"## Notes: Optional faster recordings. Install beside {pack}.\n"
                        f"## Version: {metadata(toc, 'Version')}\n"
                        "## LoadOnDemand: 1\n"
                        f"## X-Spoken-Speed-Source: {pack}\n"
                        f"## X-Spoken-Speed-Rate: {rate}\n"
                    )
                    output.writestr(f"{optional}/{optional}.toc", header)
                for count, (item, path) in enumerate(audio, 1):
                    extension = path.suffix.lower()
                    original = temporary / f"original{extension}"
                    converted = temporary / f"converted{extension}"
                    original.write_bytes(source.read(item))
                    encoder = "libvorbis" if extension == ".ogg" else "libmp3lame"
                    quality = "0" if extension == ".ogg" else "3"
                    command = [
                        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(original),
                        "-filter:a", f"atempo={rate}", "-c:a", encoder, "-q:a", quality, str(converted),
                    ]
                    subprocess.run(command, check=True)
                    optional = f"SpokenSpeed{suffix}_{path.parts[0]}"
                    output.write(converted, str(PurePosixPath(optional, *path.parts[1:])))
                    if count % 100 == 0 or count == len(audio):
                        print(f"{count}/{len(audio)} recordings", flush=True)
                    original.unlink()
                    converted.unlink()
    print(args.output)


if __name__ == "__main__":
    main()
