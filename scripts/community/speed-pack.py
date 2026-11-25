#!/usr/bin/env python3
"""Build a faster or slower copy of a Spoken voice pack and publish it as a community pack.

    python3 speed-pack.py setup
    python3 speed-pack.py SpokenQuestsAudio_enUS_Alliance SpokenQuestsAudio_enUS_Horde --speed 1.5

Each source pack becomes one community pack, `SpokenCommunity_<id>`, whose clips play at the
chosen speed and whose lengths and word times are scaled to match. Its .toc names it a team's
voice ("English · 1.5x"), so a player puts it first under Voices, in Order and the original
pack fills in any line it lacks. Then the zip goes up as a GitHub release asset and is sent to
spoken.quest for review.

Needs Python 3.9+, ffmpeg (and oggenc for Ogg packs when ffmpeg has no libvorbis) and, to
publish, the GitHub CLI `gh`. Full guide: docs/contributors/SPEED-PACKS.md.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import getpass
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path, PurePosixPath
from typing import Callable, Dict, Iterator, List, Optional, Tuple

AUDIO = (".ogg", ".mp3")
SITE = "https://spoken.quest"
MIN_SPEED, MAX_SPEED = 0.5, 4.0
# A cache entry is only reusable under the settings that made it. Bump when the encoding changes.
ENCODER_VERSION = 1
# The site's rules (apps/web/src/lib/community/rules.ts): broken ones fail the submission.
PACK_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_PACK_ID = 48
TEAM_SLUG = re.compile(r"^[a-z][a-z0-9-]{1,40}$")
LANGUAGE_KEYS = {
    "quests": "X-SpokenQuests-Language",
    "places": "X-SpokenPlaces-Language",
    "readables": "X-SpokenReadables-Language",
    "bosses": "X-SpokenBosses-Language",
}
REGISTRIES = {
    "SpokenPlacesAudioPacks": "places",
    "SpokenReadablesAudioPacks": "readables",
    "SpokenBossesAudioPacks": "bosses",
}
# The Spoken Manager's community list takes these sections only.
LISTABLE = ("quests", "places", "readables")
LANGUAGE_NAMES = {
    "enUS": "English", "deDE": "German", "esES": "Spanish", "esMX": "Latin American Spanish",
    "frFR": "French", "ptBR": "Portuguese", "ruRU": "Russian", "koKR": "Korean",
    "zhCN": "Simplified Chinese", "zhTW": "Traditional Chinese",
}


class Refusal(Exception):
    """A problem the person running the script can fix: printed without a traceback."""


# --- Lua -------------------------------------------------------------------------------------

@dataclass
class Token:
    kind: str  # name, number, string, symbol
    start: int
    end: int
    text: str


LONG_OPEN = re.compile(r"\[(=*)\[")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
NUMBER = re.compile(r"0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")


def lua_tokens(source: str) -> Iterator[Token]:
    """Names, numbers, strings and symbols, comments skipped: enough to find a value without
    mistaking the same characters inside a line's text for one."""
    i, n = 0, len(source)
    while i < n:
        ch = source[i]
        if ch.isspace():
            i += 1
        elif source.startswith("--", i):
            opened = LONG_OPEN.match(source, i + 2)
            if opened:
                close = source.find("]" + opened.group(1) + "]", opened.end())
                i = n if close < 0 else close + len(opened.group(1)) + 2
            else:
                close = source.find("\n", i)
                i = n if close < 0 else close + 1
        elif ch in "\"'":
            j = i + 1
            while j < n and source[j] != ch:
                if source[j] == "\\":
                    j += 1
                elif source[j] == "\n":
                    raise Refusal("unfinished string in Lua")
                j += 1
            yield Token("string", i, j + 1, source[i:j + 1])
            i = j + 1
        elif opened := LONG_OPEN.match(source, i):
            close = source.find("]" + opened.group(1) + "]", opened.end())
            if close < 0:
                raise Refusal("unfinished long string in Lua")
            end = close + len(opened.group(1)) + 2
            yield Token("string", i, end, source[i:end])
            i = end
        elif (ch.isdigit() or (ch == "." and i + 1 < n and source[i + 1].isdigit())) and (m := NUMBER.match(source, i)):
            yield Token("number", i, m.end(), m.group())
            i = m.end()
        elif m := NAME.match(source, i):
            yield Token("name", i, m.end(), m.group())
            i = m.end()
        else:
            yield Token("symbol", i, i + 1, ch)
            i += 1


def lua_string_value(token: Token) -> Optional[str]:
    """The value of a quoted string with no escapes, which is all a generated key or time is."""
    if token.kind != "string" or token.text[0] not in "\"'" or "\\" in token.text:
        return None
    return token.text[1:-1]


def lua_quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


LUA_KEYWORDS = {"and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto",
                "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true",
                "until", "while"}


def lua_global(name: str) -> str:
    """Bare where it is an identifier, as the quests generator (tts_cli/lua.py) writes it."""
    return name if NAME.fullmatch(name) and name not in LUA_KEYWORDS else f"_G[{lua_quote(name)}]"


def splice(source: str, edits: List[Tuple[int, int, str]]) -> str:
    out, at = [], 0
    for start, end, text in sorted(edits):
        out.append(source[at:start])
        out.append(text)
        at = end
    out.append(source[at:])
    return "".join(out)


def format_length(seconds: float) -> str:
    text = f"{seconds:.3f}".rstrip("0").rstrip(".")
    return text or "0"


def pack_times(times: List[float]) -> str:
    """pipelines/lib/word-times.mjs's packTimes: what the addon reads back as clip timings."""
    out = []
    for seconds in times:
        # Half up, as JavaScript's toFixed rounds: Python's format rounds 0.625 down.
        text = str(Decimal(seconds).quantize(Decimal("0.01"), ROUND_HALF_UP)).rstrip("0").rstrip(".")
        out.append(text[1:] if text.startswith("0.") else (text or "0"))
    return " ".join(out)


def scale_times(packed: str, speed: float) -> str:
    try:
        times = [float(part) / speed for part in packed.split()]
    except ValueError:
        raise Refusal(f"word times that are not numbers: {packed[:40]!r}")
    return pack_times(times)


Picker = Callable[[List[Token], int, Optional[str]], bool]


def scale_values(source: str, speed: float, lengths: Optional[Picker] = None,
                 times: Optional[Picker] = None) -> Tuple[str, int]:
    tokens = list(lua_tokens(source))
    edits = []
    # Each open table's name, tracked forward: scanning back per value is quadratic over the
    # quests tables, which hold one row per clip.
    tables: List[Optional[str]] = []
    for i, token in enumerate(tokens):
        if token.kind == "symbol" and token.text == "{":
            tables.append(tokens[i - 2].text if i >= 2 and tokens[i - 1].text == "=" else None)
            continue
        if token.kind == "symbol" and token.text == "}":
            if tables:
                tables.pop()
            continue
        table = tables[-1] if tables else None
        if token.kind == "number" and lengths and lengths(tokens, i, table):
            edits.append((token.start, token.end, format_length(float(token.text) / speed)))
        elif token.kind == "string" and times and times(tokens, i, table):
            value = lua_string_value(token)
            if value is None:
                raise Refusal(f"word times written in a form this script does not read: {token.text[:40]}")
            edits.append((token.start, token.end, lua_quote(scale_times(value, speed))))
    return splice(source, edits), len(edits)


def after(tokens: List[Token], i: int, *expected: str) -> bool:
    if i < len(expected):
        return False
    return [t.text for t in tokens[i - len(expected):i]] == list(expected)


def field_value(name: str) -> Picker:
    """A value written `name = <value>` in a row, as Data/Sounds.lua writes `len` and `times`."""
    return lambda tokens, i, table: after(tokens, i, name, "=")


def table_value(name: str) -> Picker:
    """A value of `<module>.<name> = { ["key"] = <value>, ... }`, as the quests tables are."""
    def pick(tokens: List[Token], i: int, table: Optional[str]) -> bool:
        keyed = after(tokens, i, "]", "=") or (
            i >= 3 and tokens[i - 1].text == "=" and tokens[i - 2].kind == "name" and tokens[i - 3].text in "{,")
        return keyed and table == name
    return pick


def rename_module(source: str, old: str, new: str, module_file: bool) -> str:
    """Renames a quests pack's global, which is named by its folder, everywhere it appears.

    Module.lua binds the module to a local, since `function _G["a-b"]:f` does not parse and a
    community folder's id may hold a hyphen. The other files reach it through the global.
    """
    tokens = list(lua_tokens(source))
    edits = []
    reference = "module" if module_file else lua_global(new)
    for i, token in enumerate(tokens):
        if token.kind == "string" and lua_string_value(token) == old:
            # `_G["Old"]`, and the name the module registers under.
            if i >= 2 and tokens[i - 1].text == "[" and tokens[i - 2].text == "_G" and module_file:
                continue
            edits.append((token.start, token.end, lua_quote(new)))
        elif token.kind == "name" and token.text == old:
            if i > 0 and tokens[i - 1].text in (".", ":"):
                continue
            edits.append((token.start, token.end, reference))
    renamed = splice(source, edits)
    if not module_file:
        return renamed
    # A pack whose folder was an identifier defined it bare: `Old = {}`. Give it the local.
    bare = re.compile(r"^module = \{\}$", re.MULTILINE)
    if bare.search(renamed):
        renamed = bare.sub(f"local module = {{}}\n{lua_global(new)} = module", renamed, count=1)
    else:
        # A team's pack already binds a local: `_G["Old"] = module`.
        renamed = renamed.replace(f"_G[{lua_quote(old)}]", lua_global(new))
    return renamed


# --- Packs -----------------------------------------------------------------------------------

@dataclass
class Source:
    """One addon folder: from a folder on disk or from a zip that holds one or more."""
    folder: str
    files: Dict[str, Callable[[], bytes]]  # path inside the folder -> its bytes
    origin: str

    def read(self, rel: str) -> bytes:
        return self.files[rel]()

    def text(self, rel: str) -> str:
        return self.read(rel).decode("utf-8-sig")


@dataclass
class Plan:
    source: Source
    section: str
    language: str
    version: str
    title: str
    team: Optional[str]
    team_name: Optional[str]
    toc: str
    pack_id: str = ""
    speed: float = 1.0
    audio: List[str] = field(default_factory=list)

    @property
    def folder(self) -> str:
        return f"SpokenCommunity_{self.pack_id}"


def read_sources(arg: str, addons: Optional[str]) -> List[Source]:
    path = Path(arg).expanduser()
    if not path.exists() and addons and os.sep not in arg and "/" not in arg:
        path = Path(addons).expanduser() / arg
    if path.is_dir():
        root = path.resolve()
        files = {}
        for item in sorted(root.rglob("*")):
            if item.is_file() and not item.is_symlink():
                files[item.relative_to(root).as_posix()] = (lambda p=item: p.read_bytes())
        return [Source(root.name, files, str(root))]
    if path.is_file() and zipfile.is_zipfile(path):
        local = threading.local()
        archive = zipfile.ZipFile(path)
        by_folder: Dict[str, Dict[str, Callable[[], bytes]]] = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            parts = PurePosixPath(info.filename.replace("\\", "/")).parts
            if len(parts) < 2 or any(part in ("", ".", "..") for part in parts) or info.filename.startswith("/"):
                raise Refusal(f"{path.name}: unsafe path {info.filename!r}")

            def reader(name=info.filename) -> bytes:
                # ZipFile reads are not thread-safe; one handle each lets the workers inflate at once.
                if not hasattr(local, "archive"):
                    local.archive = zipfile.ZipFile(path)
                return local.archive.read(name)
            by_folder.setdefault(parts[0], {})["/".join(parts[1:])] = reader
        return [Source(folder, files, f"{path.name}:{folder}") for folder, files in sorted(by_folder.items())]
    if addons and not path.exists():
        raise Refusal(f"{arg}: no such folder or zip, and no addon of that name in {addons}")
    raise Refusal(f"{arg}: no such folder or zip")


def toc_value(toc: str, key: str) -> Optional[str]:
    m = re.search(rf"^##\s*{re.escape(key)}\s*:\s*(.*?)\s*$", toc, re.MULTILINE)
    return m.group(1) if m and m.group(1) else None


def plain_title(title: str) -> str:
    """The title without the AddOns list's colour codes."""
    return re.sub(r"\|c[0-9a-fA-F]{8}|\|r", "", title).strip()


def inspect(source: Source) -> Plan:
    toc_name = f"{source.folder}.toc"
    if toc_name not in source.files:
        raise Refusal(f"{source.origin}: no {toc_name}, so it is not an addon folder")
    toc = source.text(toc_name)
    if toc_value(toc, "X-SpokenQuests-DataModule-Version"):
        section = "quests"
    else:
        section = None
        if "Data/Sounds.lua" in source.files:
            sounds = source.text("Data/Sounds.lua")
            section = next((s for registry, s in REGISTRIES.items() if registry in sounds), None)
        if not section:
            raise Refusal(f"{source.origin}: not a Spoken voice pack (no quests module, no Data/Sounds.lua registry)")
    language = toc_value(toc, LANGUAGE_KEYS[section]) or "enUS"
    if not re.fullmatch(r"[a-z]{2}[A-Z]{2}", language):
        language = "enUS"
    team = toc_value(toc, "X-Spoken-Team")
    if team and not TEAM_SLUG.match(team):
        team = None
    audio = sorted(rel for rel in source.files if rel.lower().endswith(AUDIO))
    if not audio:
        raise Refusal(f"{source.origin}: no .ogg or .mp3 clips in it")
    return Plan(source=source, section=section, language=language,
                version=toc_value(toc, "Version") or "1.0.0",
                title=plain_title(toc_value(toc, "Title") or source.folder),
                team=team, team_name=toc_value(toc, "X-Spoken-TeamName"), toc=toc, audio=audio)


def speed_tag(speed: float) -> str:
    return f"x{round(speed * 100)}"


def speed_label(speed: float) -> str:
    return f"{speed:g}x"


def default_pack_id(prefix: str, folder: str, speed: float) -> str:
    """`<prefix>-quests-alliance-enus-x150`: the maker's prefix keeps two makers' ids apart."""
    name = re.sub(r"^Spoken", "", folder)
    name = re.sub(r"Audio", "", name, count=1)
    # Words split, a language code kept whole: QuestsAlliance_enUS -> quests-alliance-enus.
    name = re.sub(r"(?<=[a-z])(?=[A-Z][a-z])", "-", name)
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    parts = [p for p in (prefix, slug, speed_tag(speed)) if p]
    return "-".join(parts)


def team_of(plan: Plan) -> Tuple[str, str]:
    """A voice of its own for each speed. A team's pack keeps its team in the new voice, so two
    teams' faster packs stay two voices."""
    speed = plan.speed
    slug = f"{plan.team}-{speed_tag(speed)}" if plan.team else f"speed-{speed_tag(speed)}"
    name = f"{plan.team_name or plan.team} {speed_label(speed)}" if plan.team else speed_label(speed)
    if not TEAM_SLUG.match(slug):
        raise Refusal(f"{plan.source.origin}: its team gives the voice an unusable slug {slug!r}")
    return slug, name


def rewrite_toc(plan: Plan, version: str, author: Optional[str]) -> str:
    team, team_name = team_of(plan)
    toc = plan.toc.replace(f"\\AddOns\\{plan.source.folder}\\", f"\\AddOns\\{plan.folder}\\")
    replace = {
        "Title": f"{toc_value(toc, 'Title') or plan.source.folder} ({speed_label(plan.speed)})",
        "Version": version,
        "X-Spoken-Team": team,
        "X-Spoken-TeamName": team_name,
        "X-Spoken-SpeedOf": f"{plan.source.folder} {plan.version}",
        "X-Spoken-Speed": f"{plan.speed:g}",
    }
    if author:
        replace["Author"] = author
    lines = toc.splitlines()
    for key, value in replace.items():
        pattern = re.compile(rf"^##\s*{re.escape(key)}\s*:")
        line = f"## {key}: {value}"
        for i, existing in enumerate(lines):
            if pattern.match(existing):
                lines[i] = line
                break
        else:
            # After the header block, where the client reads metadata.
            at = next((i for i, existing in enumerate(lines) if not existing.startswith("##")), len(lines))
            lines.insert(at, line)
    return "\n".join(lines) + "\n"


def rewrite_lua(plan: Plan, rel: str, source: str) -> Tuple[str, int]:
    speed, scaled = plan.speed, 0
    if plan.section == "quests":
        name = PurePosixPath(rel).name
        if name == "sound_length_table.lua":
            source, scaled = scale_values(source, speed, lengths=table_value("SoundLengthLookupByFileName"))
        elif name == "word_times_table.lua":
            source, scaled = scale_values(source, speed, times=table_value("WordTimesByFileName"))
        source = rename_module(source, plan.source.folder, plan.folder, module_file=(rel == "Module.lua"))
    elif rel == "Data/Sounds.lua":
        source, scaled = scale_values(source, speed, field_value("len"), field_value("times"))
    return source, scaled


def check_lua(files: Dict[str, bytes]) -> None:
    """Compiles every Lua file with luajit when it is installed: a pack that does not parse
    fails for every player who installs it."""
    luajit = shutil.which("luajit")
    if not luajit:
        return
    for rel, data in files.items():
        if not rel.endswith(".lua"):
            continue
        result = subprocess.run([luajit, "-e", "assert(loadstring(io.read('*a')))"],
                                input=data, capture_output=True)
        if result.returncode != 0:
            raise Refusal(f"{rel} no longer parses: {result.stderr.decode(errors='replace').strip()}")


# --- Audio -----------------------------------------------------------------------------------

def atempo(speed: float) -> str:
    """ffmpeg's atempo takes 0.5 to 2 per stage in older builds, so larger changes chain."""
    stages, rest = [], speed
    while rest > 2.0:
        stages.append(2.0)
        rest /= 2.0
    while rest < 0.5:
        stages.append(0.5)
        rest /= 0.5
    stages.append(rest)
    return ",".join(f"atempo={stage:.6g}" for stage in stages)


def vorbis_rate(data: bytes) -> Optional[int]:
    at = data.find(b"\x01vorbis", 0, 4096)
    if at < 0 or len(data) < at + 16:
        return None
    return int.from_bytes(data[at + 12:at + 16], "little")


@dataclass
class Encoder:
    ffmpeg: str
    oggenc: Optional[str]
    libvorbis: bool

    @staticmethod
    def find() -> "Encoder":
        ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
        if not ffmpeg:
            raise Refusal("ffmpeg is not installed. See docs/contributors/SPEED-PACKS.md.")
        encoders = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
        return Encoder(ffmpeg, os.environ.get("OGGENC") or shutil.which("oggenc"), " libvorbis " in encoders)

    def settings(self) -> dict:
        return {"version": ENCODER_VERSION, "vorbis": "libvorbis" if self.libvorbis else "oggenc"}

    def encode(self, src: Path, out: Path, speed: float, extension: str, rate: Optional[int]) -> None:
        decode = [self.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(src),
                  "-filter:a", atempo(speed)]
        if extension == ".mp3":
            # The packs' own MP3 setting (scripts/quests/package-audio.sh), so a copy is no larger.
            run([*decode, "-codec:a", "libmp3lame", "-q:a", "6", "-f", "mp3", "-y", str(out)])
            return
        # The two Ogg profiles the packs ship: -q -1 at 22 kHz, -q 0 at 44.1 kHz.
        quality = "-1" if rate and rate <= 22050 else "0"
        if self.libvorbis:
            run([*decode, "-codec:a", "libvorbis", "-q:a", quality, "-f", "ogg", "-y", str(out)])
            return
        if not self.oggenc:
            raise Refusal("this ffmpeg has no libvorbis and oggenc is not installed. "
                          "Install vorbis-tools. See docs/contributors/SPEED-PACKS.md.")
        decoder = subprocess.Popen([*decode, "-f", "wav", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        encoder = subprocess.run([self.oggenc, "-Q", "-q", quality, "-o", str(out), "-"],
                                 stdin=decoder.stdout, capture_output=True)
        decoder.stdout.close()
        _, decode_error = decoder.communicate()
        if decoder.returncode != 0 or encoder.returncode != 0:
            raise Refusal(f"encoding {src.name} failed: {(decode_error + encoder.stderr).decode(errors='replace').strip()}")


def run(command: List[str]) -> None:
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        raise Refusal(f"{Path(command[0]).name} failed: {result.stderr.decode(errors='replace').strip()}")


class Cache:
    """Encoded clips under `<root>/<pack id>/<speed>/`, named by the SHA-256 of their source, so a
    rebuild encodes only the clips that are new or changed."""

    def __init__(self, root: Path, pack_id: str, speed: float, settings: dict):
        self.dir = root / pack_id / f"{speed:g}"
        self.dir.mkdir(parents=True, exist_ok=True)
        marker = self.dir / "settings.json"
        wanted = json.dumps(settings, sort_keys=True)
        if not marker.exists() or marker.read_text() != wanted:
            # Made under other settings: none of it is this build's.
            for old in self.dir.iterdir():
                if old.is_file():
                    old.unlink()
            marker.write_text(wanted)

    def path(self, digest: str, extension: str) -> Path:
        return self.dir / f"{digest}{extension}"

    def prune(self, used: Dict[str, Path]) -> None:
        """Drops what this build did not use: clips the source no longer has."""
        keep = {clip.name for clip in used.values()}
        for entry in self.dir.iterdir():
            if entry.is_file() and entry.name != "settings.json" and entry.name not in keep:
                entry.unlink()


def user_dir(windows: str, windows_default: str, xdg: str, xdg_default: str) -> Path:
    if os.name == "nt":
        return Path(os.environ.get(windows, Path.home() / windows_default)) / "spoken"
    return Path(os.environ.get(xdg, Path.home() / xdg_default)) / "spoken"


def default_cache_root() -> Path:
    return user_dir("LOCALAPPDATA", "AppData/Local", "XDG_CACHE_HOME", ".cache") / "speed-packs"


def encode_all(plan: Plan, cache: Cache, encoder: Encoder, jobs: int,
               progress: Callable[[str], None]) -> Dict[str, Path]:
    total, done, reused = len(plan.audio), 0, 0
    results: Dict[str, Path] = {}

    def one(rel: str) -> Tuple[str, Path, bool]:
        data = plan.source.read(rel)
        extension = Path(rel).suffix.lower()
        digest = hashlib.sha256(data).hexdigest()
        target = cache.path(digest, extension)
        if target.exists():
            return rel, target, True
        rate = vorbis_rate(data) if extension == ".ogg" else None
        part = target.with_name(target.name + f".{threading.get_ident()}.part")
        src = target.with_name(target.name + f".{threading.get_ident()}.src{extension}")
        try:
            src.write_bytes(data)
            encoder.encode(src, part, plan.speed, extension, rate)
            # Via .part and a rename, so a cut-off run never leaves a truncated clip in the cache.
            os.replace(part, target)
        finally:
            for leftover in (src, part):
                if leftover.exists():
                    leftover.unlink()
        return rel, target, False

    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(one, rel) for rel in plan.audio]
        try:
            for future in concurrent.futures.as_completed(futures):
                rel, target, cached = future.result()
                results[rel] = target
                done += 1
                reused += cached
                if done % 50 == 0 or done == total:
                    progress(f"  {done}/{total} clips ({reused} from the cache)")
        except BaseException:
            for future in futures:
                future.cancel()
            raise
    return results


# --- Build -----------------------------------------------------------------------------------

# Fixed, so the same clips give the same zip and the same checksum on every rebuild.
ZIP_TIME = (2020, 1, 1, 0, 0, 0)


def build(plan: Plan, version: str, author: Optional[str], clips: Dict[str, Path], out: Path) -> Path:
    files: Dict[str, bytes] = {}
    scaled = 0
    for rel in sorted(plan.source.files):
        if rel.lower().endswith(AUDIO):
            continue
        if rel == f"{plan.source.folder}.toc":
            files[f"{plan.folder}.toc"] = rewrite_toc(plan, version, author).encode("utf-8")
        elif rel.endswith(".lua"):
            text, count = rewrite_lua(plan, rel, plan.source.text(rel))
            scaled += count
            files[rel] = text.encode("utf-8")
        else:
            files[rel] = plan.source.read(rel)
    if scaled == 0:
        raise Refusal(f"{plan.source.origin}: found no lengths to scale. Is it a pack this script knows?")
    check_lua(files)
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{plan.folder}.zip"
    part = target.with_name(target.name + ".part")
    with zipfile.ZipFile(part, "w") as archive:
        for rel in sorted([*files, *plan.audio]):
            info = zipfile.ZipInfo(f"{plan.folder}/{rel}", ZIP_TIME)
            # Clips are already compressed.
            info.compress_type = zipfile.ZIP_DEFLATED if rel in files else zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            archive.writestr(info, files[rel] if rel in files else clips[rel].read_bytes())
    os.replace(part, target)
    return target


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --- Publishing ------------------------------------------------------------------------------

def version_key(version: str) -> Optional[Tuple]:
    """apps/web/src/lib/community/rules.ts's compareVersions, as a sort key."""
    m = re.fullmatch(r"v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?", version.strip())
    if not m:
        return None
    core = tuple(int(part) for part in m.group(1).split("."))
    pre = m.group(2)
    if not pre:
        return (core, (1,))
    return (core, (0, tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre.split("."))))


def newer(a: str, b: str) -> bool:
    x, y = version_key(a), version_key(b)
    if x is None or y is None:
        return False
    width = max(len(x[0]), len(y[0]))
    pad = lambda core: core + (0,) * (width - len(core))  # noqa: E731
    return (pad(x[0]), x[1]) > (pad(y[0]), y[1])


def next_version(source_version: str, live: Optional[str]) -> str:
    """The source pack's version, or one step past the live one where that is not newer: a
    rebuild of the same source still has to be a version the Manager offers."""
    if not live or newer(source_version, live):
        return source_version
    m = re.fullmatch(re.escape(source_version) + r"\.(\d+)", live)
    return f"{source_version}.{int(m.group(1)) + 1 if m else 1}"


class Site:
    def __init__(self, base: str, token: str):
        self.base, self.token = base.rstrip("/"), token

    def call(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "spoken-speed-pack",
        })
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            try:
                answer = json.loads(error.read() or b"{}")
            except ValueError:
                answer = {}
            details = "; ".join(f"{k}: {v}" for k, v in (answer.get("errors") or {}).items())
            message = answer.get("error") or error.reason
            raise Refusal(f"spoken.quest refused it ({error.code}): {message}" + (f" ({details})" if details else ""))
        except urllib.error.URLError as error:
            raise Refusal(f"could not reach {self.base}: {error.reason}")

    def owned(self) -> Dict[str, dict]:
        return {pack["id"]: pack for pack in self.call("GET", "/api/v1/packs").get("packs", [])}


def gh(*args: str) -> str:
    if not shutil.which("gh"):
        raise Refusal("the GitHub CLI `gh` is not installed. See docs/contributors/SPEED-PACKS.md.")
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise Refusal(f"gh {args[0]} {args[1] if len(args) > 1 else ''} failed: {result.stderr.strip()}")
    return result.stdout


def upload(repo: str, tag: str, title: str, notes: str, zip_path: Path) -> str:
    """The zip as an asset of a new release, `tag`. Each version is its own release: the site
    refuses a version whose link is the live one's."""
    exists = subprocess.run(["gh", "release", "view", tag, "--repo", repo], capture_output=True).returncode == 0
    if exists:
        gh("release", "upload", tag, str(zip_path), "--repo", repo, "--clobber")
    else:
        gh("release", "create", tag, str(zip_path), "--repo", repo, "--title", title, "--notes", notes)
    return f"https://github.com/{repo}/releases/download/{tag}/{zip_path.name}"


def describe(plan: Plan) -> Tuple[str, str]:
    language = LANGUAGE_NAMES.get(plan.language, plan.language)
    voice = f"{language} · {team_of(plan)[1]}"
    title = f"{plan.title} at {speed_label(plan.speed)}"[:80]
    description = (f"Every clip of {plan.source.folder} {plan.version} at {speed_label(plan.speed)}, its captions "
                   f"timed to match. Install it beside the original pack and put {voice} first under "
                   f"Voices, in Order in Spoken's settings; the original plays any line this pack lacks.")
    return title, description[:400]


# --- Setup -----------------------------------------------------------------------------------

def config_path() -> Path:
    return user_dir("APPDATA", "AppData/Roaming", "XDG_CONFIG_HOME", ".config") / "speed-pack.json"


def load_config() -> dict:
    path = config_path()
    config = json.loads(path.read_text()) if path.exists() else {}
    if os.environ.get("SPOKEN_TOKEN"):
        config["token"] = os.environ["SPOKEN_TOKEN"]
    return config


def ask(prompt: str, default: Optional[str] = None, secret: bool = False) -> str:
    shown = f"{prompt} [{default}]: " if default else f"{prompt}: "
    answer = (getpass.getpass(shown) if secret else input(shown)).strip()
    return answer or (default or "")


def guess_addons() -> Optional[str]:
    candidates = [
        "/Applications/World of Warcraft/_classic_era_/Interface/AddOns",
        "C:/Program Files (x86)/World of Warcraft/_classic_era_/Interface/AddOns",
        "C:/Program Files/World of Warcraft/_classic_era_/Interface/AddOns",
    ]
    return next((c for c in candidates if Path(c).is_dir()), None)


def setup() -> None:
    config = load_config()
    print("Speed packs: one-time setup. Press Enter to keep the value in brackets.\n")
    config["addons"] = ask("Your WoW AddOns folder, to name packs by folder name (optional)",
                           config.get("addons") or guess_addons())
    login = ""
    if shutil.which("gh"):
        status = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
        if status.returncode != 0:
            print("Sign in to GitHub first: gh auth login")
        else:
            login = subprocess.run(["gh", "api", "user", "-q", ".login"], capture_output=True, text=True).stdout.strip()
    else:
        print("The GitHub CLI `gh` is not installed; you can build packs, but not publish them.")
    config["repo"] = ask("GitHub repository for the zips, owner/name (public)",
                         config.get("repo") or (f"{login}/spoken-speed-packs" if login else None))
    if config["repo"] and login and subprocess.run(["gh", "repo", "view", config["repo"]],
                                                   capture_output=True).returncode != 0:
        if ask(f"{config['repo']} does not exist. Create it, public? y/n", "y").lower().startswith("y"):
            gh("repo", "create", config["repo"], "--public", "--description", "Spoken speed packs")
    prefix = re.sub(r"[^a-z0-9]+", "-", (config.get("prefix") or login or "").lower()).strip("-")
    config["prefix"] = ask("A prefix for your pack ids, so they do not clash with other makers'", prefix or None)
    config["author"] = ask("Author name shown on your packs", config.get("author") or login or None)
    print(f"\nCreate a token on {SITE}/profile with the Community packs option.")
    token = ask("Paste the token (leave empty to keep the saved one)", None, secret=True)
    if token:
        config["token"] = token
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    stored = {k: v for k, v in config.items() if v}
    path.write_text(json.dumps(stored, indent=2) + "\n")
    if os.name != "nt":
        path.chmod(0o600)
    print(f"\nSaved to {path}.")


# --- Main ------------------------------------------------------------------------------------

def parse_speed(text: str) -> float:
    try:
        speed = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError("a number, such as 1.5 (faster) or 0.8 (slower)")
    if not MIN_SPEED <= speed <= MAX_SPEED or speed == 1:
        raise argparse.ArgumentTypeError(f"from {MIN_SPEED} to {MAX_SPEED}, and not 1")
    if abs(speed * 100 - round(speed * 100)) > 1e-9:
        raise argparse.ArgumentTypeError("at most two decimals, such as 1.25")
    return speed


def main(argv: Optional[List[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    try:
        if argv[:1] == ["setup"]:
            setup()
            return 0
        return run_all(parse_args(argv))
    except Refusal as refusal:
        print(f"error: {refusal}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nStopped. Clips encoded so far stay in the cache.", file=sys.stderr)
        return 130


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="speed-pack.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sources", nargs="+", metavar="PACK",
                        help="an addon folder, a release zip, or an addon's name in your AddOns folder")
    parser.add_argument("--speed", type=parse_speed, required=True, help="1.5 is faster, 0.8 slower")
    parser.add_argument("--build-only", action="store_true", help="build the zips, upload and submit nothing")
    parser.add_argument("--out", type=Path, default=Path("speed-packs"), help="where the zips go (./speed-packs)")
    parser.add_argument("--id", dest="pack_id", help="the pack id, for a single source")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 2, help="clips encoded at once")
    parser.add_argument("--cache", type=Path, default=None, help=f"the clip cache ({default_cache_root()})")
    return parser.parse_args(argv)


def run_all(args: argparse.Namespace) -> int:
    config = load_config()
    publish = not args.build_only
    if publish:
        missing = [key for key in ("repo", "token") if not config.get(key)]
        if missing:
            raise Refusal(f"no {' or '.join(missing)} set. Run `speed-pack.py setup` first, or pass --build-only.")
    sources = [source for arg in args.sources for source in read_sources(arg, config.get("addons"))]
    if args.pack_id and len(sources) > 1:
        raise Refusal("--id names one pack, and these sources make several")
    plans = []
    for source in sources:
        plan = inspect(source)
        plan.speed = args.speed
        plan.pack_id = args.pack_id or default_pack_id(config.get("prefix", ""), source.folder, args.speed)
        if not PACK_ID.match(plan.pack_id) or len(plan.pack_id) > MAX_PACK_ID:
            raise Refusal(f"pack id {plan.pack_id!r} breaks the site's rule (lower-case letters, digits, "
                          f"single hyphens, at most {MAX_PACK_ID}). Pass --id.")
        team_of(plan)
        if publish and plan.section not in LISTABLE:
            raise Refusal(f"{source.origin}: the Spoken Manager does not list {plan.section} packs yet. "
                          "Build it with --build-only.")
        plans.append(plan)

    site = Site(SITE, config["token"]) if publish else None
    owned = site.owned() if site else {}
    encoder = Encoder.find()
    cache_root = args.cache or default_cache_root()
    for plan in plans:
        print(f"{plan.source.origin}: {plan.section}, {plan.language}, {len(plan.audio)} clips "
              f"-> {plan.folder} at {speed_label(plan.speed)}")
        pack = owned.get(plan.pack_id)
        if pack and pack.get("pending"):
            raise Refusal(f"{plan.pack_id} already has version {pack['pending']['version']} waiting for review. "
                          "Withdraw it on spoken.quest/packs first, or wait for the decision.")
        live = pack.get("live") if pack else None
        version = next_version(plan.version, live["version"] if live else None)
        cache = Cache(cache_root, plan.pack_id, plan.speed, encoder.settings())
        clips = encode_all(plan, cache, encoder, max(1, args.jobs), print)
        zip_path = build(plan, version, config.get("author"), clips, args.out)
        cache.prune(clips)
        checksum, size = sha256_of(zip_path), zip_path.stat().st_size
        print(f"  built {zip_path} ({size / 1024 ** 2:.1f} MB), version {version}")
        if not publish:
            continue
        if live and live.get("sha256") == checksum:
            print("  unchanged since the live version: nothing to publish")
            continue
        title, description = describe(plan)
        tag = f"{plan.pack_id}-v{version}"
        url = upload(config["repo"], tag, title, description, zip_path)
        print(f"  uploaded {url}")
        fields = {"title": title, "author": config.get("author") or config["repo"].split("/")[0],
                  "description": description, "version": version, "size": size, "sha256": checksum,
                  "url": url, "homepage": f"https://github.com/{config['repo']}", "license": None}
        if pack:
            site.call("POST", f"/api/v1/packs/{plan.pack_id}/submissions", fields)
        else:
            site.call("POST", "/api/v1/packs", {**fields, "id": plan.pack_id, "lang": plan.language,
                                                "section": plan.section})
        print(f"  sent {plan.pack_id} {version} to spoken.quest for review")
    return 0


if __name__ == "__main__":
    sys.exit(main())
