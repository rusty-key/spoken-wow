#!/usr/bin/env python3
"""Package supplied combat voice sets without generating or replacing audio."""

import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import wave
import zipfile


ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = ROOT / "apps/web/src/lib/combat/lines.json"
PACK = json.loads((ROOT / "apps/web/src/lib/combat/audio-pack.json").read_text(encoding="utf-8"))
FORMATS = {".wav", ".mp3", ".ogg"}


def duration_of(file: Path, ffprobe: str | None) -> float:
    if file.suffix.lower() == ".wav":
        with wave.open(str(file), "rb") as audio:
            if audio.getsampwidth() != 2 or audio.getnchannels() not in (1, 2):
                raise ValueError(f"{file.name}: use 16-bit PCM WAV, mono or stereo")
            duration = audio.getnframes() / audio.getframerate()
            if duration > 6:
                raise ValueError(f"{file.name}: {duration:.3f}s exceeds the 6-second limit")
            expected = audio.getnframes() * audio.getnchannels() * audio.getsampwidth()
            if len(audio.readframes(audio.getnframes())) != expected:
                raise ValueError(f"{file.name}: truncated WAV recording")
    else:
        if not ffprobe:
            raise ValueError("ffprobe is required for MP3/OGG recordings; PCM WAV needs no extra tools")
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_name",
             "-of", "json", str(file.resolve())],
            check=True, capture_output=True, text=True, timeout=30,
        )
        metadata = json.loads(result.stdout)
        expected_codec = "mp3" if file.suffix.lower() == ".mp3" else "vorbis"
        if [stream.get("codec_name") for stream in metadata.get("streams", [])] != [expected_codec]:
            raise ValueError(f"{file.name}: expected a single {expected_codec} audio stream")
        duration = float(metadata["format"]["duration"])
    if not math.isfinite(duration) or not 0.001 <= duration <= 6:
        raise ValueError(f"{file.name}: duration must be between 0.001 and 6 seconds")
    # Round up so the addon does not consider the reaction finished before its final sample.
    return math.ceil(duration * 1000) / 1000


def recordings_for(source: Path, voice: str, keys: list[str]) -> dict[str, Path]:
    recordings = {}
    for file in source.iterdir():
        if not file.is_file() or file.suffix.lower() not in FORMATS:
            continue
        key = file.stem.removeprefix(f"{voice}-")
        if key not in keys:
            raise ValueError(f"Unexpected recording {file.name}; name files 01 through 08")
        if key in recordings:
            raise ValueError(f"More than one recording for line {key}")
        recordings[key] = file
    missing = [key for key in keys if key not in recordings]
    if missing:
        raise ValueError(f"Missing recordings: {', '.join(missing)} ({voice})")
    if any(file.stat().st_size > 8 * 1024 * 1024 for file in recordings.values()):
        raise ValueError("A recording exceeds 8 MiB")
    return recordings


def package_recordings(source: Path, output: Path, ffprobe: str | None = None, voice: str | None = None) -> dict[str, int]:
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    known = {item["id"] for item in catalogue["voices"]}
    keys = catalogue["keys"]
    if not source.is_dir():
        raise ValueError(f"Recording folder does not exist: {source}")
    if voice is not None or any(file.is_file() and file.suffix.lower() in FORMATS for file in source.iterdir()):
        sources = {voice or "nightelf-female-player": source}
    else:
        sources = {folder.name: folder for folder in sorted(source.iterdir()) if folder.is_dir()}
    if not sources:
        raise ValueError("No voice sets supplied")
    unknown = sources.keys() - known
    if unknown:
        raise ValueError("Unknown combat voice: " + ", ".join(sorted(unknown)))
    manifest = ["local addon = ...", "SpokenCombatAudioPacks = SpokenCombatAudioPacks or {}"]
    files = {}
    for identity, folder in sources.items():
        recordings = recordings_for(folder, identity, keys)
        durations = {key: duration_of(recordings[key], ffprobe) for key in keys}
        manifest.extend([f'SpokenCombatAudioPacks[addon .. ":{identity}"] = {{',
                         f'    version = 1, addon = addon, language = "enUS", voice = "{identity}",', "    clips = {"])
        for key in keys:
            file = recordings[key]
            extension = file.suffix.lower()[1:]
            manifest.append(f'        {{ key = "{key}", length = {durations[key]:.3f}, format = "{extension}" }},')
            files[f"{PACK['addon']}/Sounds/Combat/{identity}-{key}.{extension}"] = file
        manifest.extend(["    },", "}", ""])
    if output.resolve() in {file.resolve() for file in files.values()}:
        raise ValueError("Output must not replace a supplied recording")
    addon = PACK["addon"]
    toc = (ROOT / "addons" / addon / f"{addon}.toc").read_text(encoding="utf-8")
    if f"## Version: {PACK['version']}\n" not in toc or f"## Interface: {PACK['interface']}\n" not in toc:
        raise ValueError("Combat audio pack metadata differs from its .toc")
    # Validation precedes opening the output, so a bad input set cannot replace a good package.
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{addon}/{addon}.toc", toc)
        archive.writestr(f"{addon}/Data/Sounds.lua", "\n".join(manifest))
        for name, file in files.items():
            archive.write(file, name)
    return {identity: len(keys) for identity in sources}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recordings", type=Path, help="Folder containing 01.wav through 08.wav (MP3/OGG also accepted)")
    parser.add_argument("--voice", help="Catalogue voice for a single folder; otherwise supply subfolders named after voice ids. A flat folder defaults to nightelf-female-player.")
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / f"{PACK['addon']}-{PACK['version']}.zip")
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe"), help="ffprobe executable for MP3/OGG input")
    args = parser.parse_args()
    try:
        inventory = package_recordings(args.recordings, args.output, args.ffprobe, args.voice)
    except (ValueError, OSError, wave.Error, subprocess.SubprocessError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"Packaged supplied voice sets: {args.output.resolve()}")
    print("Voice sets included:")
    for identity, count in inventory.items():
        print(f"  - {identity}: {count} recordings")
    print("Installing this zip replaces the voice sets available from SpokenCombatAudio. "
          "Include every set you want to keep available; sets omitted from this zip will no longer be offered by that addon.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
