"""Sentence pieces: a finished sound pack, cut so that a stopped line can resume from its sentence.

The client can start a sound only from its beginning, so a line kept as pieces played back to back
is the only way to resume part-way. This reads a pack as the build leaves it and writes a converted
copy, so nothing before it changes.

Where a quests line has ElevenLabs word times (the build ships them in the pack's
`generated/word_times_table.lua`) and the corpus holds its text, each cut goes just before the first
word of a sentence, read off the times: nothing is measured. Every other line is measured, and cuts
go in the middle of pauses at least `min_pause` long (full stops measured 0.5-0.7 s, commas about
0.26 s), so every join is a pause the take already had. Either way a piece still longer than
`max_piece` is cut again, at a clause or a shorter pause, since some voices pause less between
sentences. Packets are copied, never re-encoded. A split line becomes a folder of 01.ogg, 02.ogg, ... and its piece lengths go in
`generated/sound_pieces_table.lua` (quests packs) or a `pieces` field beside its `len` in
`Data/Sounds.lua` (Places, Readables and Bosses). A line that stays whole keeps its file.
"""
import collections
import concurrent.futures
import csv
import gzip
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field

from tts_cli.length_table import DATAMODULE_TABLE_GUARD_CLAUSE
from tts_cli.store import AUDIO_EXTENSIONS

TABLE_FILE = "sound_pieces_table.lua"
TABLE_NAME = "SoundPiecesByFileName"
TOC_MARKER = "## X-SpokenQuests-Pieces: 1"
LOOKUP_TOC_MARKER = "## X-Spoken-Pieces: 1"
LOOKUP_TABLE = os.path.join("Data", "Sounds.lua")
#: One entry of a lookup pack's Data/Sounds.lua, as its generators write it: the file (a Lua string,
#: backslashes escaped) and then its length.
_LOOKUP_ENTRY = re.compile(r'(file = "((?:[^"\\]|\\.)*)", len = ([0-9.]+))')

#: Seconds of quiet that count as the end of a sentence. Full stops measured 0.5 to 0.7 s and
#: commas about 0.26 s, so this takes the first and leaves the second.
DEFAULT_MIN_PAUSE = 0.45
#: Quieter than this is a pause. The takes are normalised speech, so a fixed level holds across
#: them.
DEFAULT_NOISE_DB = -35.0
#: A shorter piece is merged into the next: a resume that backs up less than this gains nothing
#: over the line, and every piece is a file.
DEFAULT_MIN_PIECE = 2.0
#: A shorter tail stays on the piece before it, so a line never ends on a scrap.
DEFAULT_MIN_TAIL = 1.5
#: Longer than this, a piece is cut again at shorter pauses: a resume should not back up most of a line.
DEFAULT_MAX_PIECE = 12.0
#: The shortest pause that second cut may use. 0 turns it off.
DEFAULT_FALLBACK_PAUSE = 0.25

#: The word times a quests pack ships, keyed by line name like the length table (tts_cli/build.py).
WORD_TIMES_FILE = "word_times_table.lua"
#: The text the times were laid on: the corpus the build reads (tts_cli/corpus.py). Read here as a
#: plain file, so this module still runs where only it is copied, and without one it measures.
DEFAULT_CORPUS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "corpus", "corpus.json.gz")
#: The TOC key naming a pack's language, as tts_cli/build.py writes it. The corpus is English, so a
#: pack in another language is measured.
LANGUAGE_KEY = "X-SpokenQuests-Language"
#: A timed cut goes this long before the first word of its sentence, inside the pause before it. On
#: 789-accept each full stop's pause ended 0.04 to 0.09 s before the word's time (the times run a
#: little late) and began 0.6 s or more before it, so this lands near the middle of each.
WORD_LEAD = 0.25
#: Words ending in a full stop that do not end a sentence.
ABBREVIATIONS = {"mr.", "mrs.", "ms.", "dr.", "st.", "mt.", "lt.", "sgt.", "capt.", "col.", "gen.",
                 "cmdr.", "vs.", "jr.", "sr."}

_TIMES_ENTRY = re.compile(r'\["((?:[^"\\]|\\.)*)"\]\s*=\s*"([^"]*)"')
_SENTENCE_END = re.compile(r'[.!?\u2026]["\'\u201d\u2019)\]]*$')
_CLAUSE_END = re.compile(r'[,;:\u2014\u2013]["\'\u201d\u2019)\]]*$')
_OPENING = "\"'\u201c\u2018(["

_SILENCE_START = re.compile(r"silence_start: (-?[\d.]+)")
_SILENCE_END = re.compile(r"silence_end: (-?[\d.]+)")


@dataclass
class Settings:
    min_pause: float = DEFAULT_MIN_PAUSE
    noise_db: float = DEFAULT_NOISE_DB
    min_piece: float = DEFAULT_MIN_PIECE
    min_tail: float = DEFAULT_MIN_TAIL
    max_piece: float = DEFAULT_MAX_PIECE
    fallback_pause: float = DEFAULT_FALLBACK_PAUSE
    # "copy" keeps the packets; "encode" re-encodes each piece at the shipping quality, which is
    # smaller (each copied piece repeats the stream's ~3.5 KB of headers) at the cost of a second
    # lossy pass.
    mode: str = "copy"
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"


@dataclass
class LineResult:
    name: str
    relative_path: str
    duration: float
    bytes_before: int
    lengths: list = field(default_factory=list)
    bytes_after: int = 0
    #: "times" where the line was cut at its word times, "pauses" where it was measured.
    method: str = "pauses"

    @property
    def split(self) -> bool:
        return len(self.lengths) > 1


def _choose(firsts, spares, duration, min_piece, min_tail, max_piece):
    """Cuts at `firsts`, the sentence ends, in order, where each leaves both sides long enough; then a
    piece longer than `max_piece` is cut at the strongest of `spares`, (seconds, strength), that fits."""
    cuts = []
    last = 0.0
    for at in firsts:
        if at - last >= min_piece and duration - at >= min_tail:
            cuts.append(round(at, 3))
            last = at
    if not max_piece or not spares:
        return cuts
    spare = sorted((round(at, 3), strength) for at, strength in spares if round(at, 3) not in cuts)
    changed = True
    while changed:
        changed = False
        bounds = [0.0, *cuts, duration]
        for a, b in zip(bounds, bounds[1:]):
            if b - a <= max_piece:
                continue
            fits = [(strength, -abs(at - (a + b) / 2), at) for at, strength in spare
                    if at - a >= min_piece and b - at >= (min_tail if b == duration else min_piece)]
            if fits:
                at = max(fits)[2]
                cuts = sorted([*cuts, at])
                spare = [(t, strength) for t, strength in spare if t != at]
                changed = True
                break
    return cuts


def choose_cuts(silences, duration, min_piece=DEFAULT_MIN_PIECE, min_tail=DEFAULT_MIN_TAIL,
                min_pause=0.0, max_piece=None, fallback_pause=None):
    """The times to cut a line at, from its pauses as (start, end) seconds, in order.

    Pauses at least `min_pause` long are sentence ends and are cut first. A piece still longer than
    `max_piece` is then cut at the longest of its pauses at least `fallback_pause` long, until it
    fits or no pause leaves both sides `min_piece` long.
    """
    firsts = [(start + end) / 2 for start, end in silences if end - start >= min_pause]
    spares = [((start + end) / 2, end - start) for start, end in silences
              if fallback_pause and end - start >= fallback_pause]
    return _choose(firsts, spares, duration, min_piece, min_tail, max_piece)


def _abbreviation(word: str) -> bool:
    bare = word.lstrip(_OPENING).lower()
    return bare in ABBREVIATIONS or re.fullmatch(r"[a-z]\.", bare) is not None


def sentence_starts(text: str):
    """The words of `text`, split at whitespace as the word times are, that start a sentence after
    the first, and those that start a clause, as two lists of indices.

    A word starts a sentence after a full stop, question or exclamation mark, or ellipsis, unless it
    is lower case (an ellipsis inside a sentence) or the stop ends an abbreviation; and after a
    line break, as each paragraph does. A word after a comma, semicolon, colon or dash starts a clause.
    """
    tokens = list(re.finditer(r"\S+", text))
    sentences, clauses = [], []
    for i in range(1, len(tokens)):
        before, word = tokens[i - 1].group(), tokens[i].group()
        if "\n" in text[tokens[i - 1].end():tokens[i].start()]:
            sentences.append(i)
        elif (_SENTENCE_END.search(before) and not _abbreviation(before)
              and not word.lstrip(_OPENING)[:1].islower()):
            sentences.append(i)
        elif _CLAUSE_END.search(before):
            clauses.append(i)
    return sentences, clauses


def choose_timed_cuts(text: str, times, duration, min_piece=DEFAULT_MIN_PIECE, min_tail=DEFAULT_MIN_TAIL,
                      max_piece=None, cut_clauses=True):
    """The times to cut a line at, from the start of each of its words, or None where the times do
    not fit its text (another count, out of order, or past its end), so the line is measured instead.

    A cut goes WORD_LEAD before the first word of each sentence, but never nearer the word before
    than the middle of the two: that word must be heard whole. A piece still longer than `max_piece`
    is cut at a clause, the one whose words are furthest apart first.
    """
    words = len(text.split())
    if (not words or len(times) != words or any(b < a for a, b in zip(times, times[1:]))
            or times[-1] >= duration):
        return None
    sentences, clauses = sentence_starts(text)

    def at(i):
        return max(times[i] - WORD_LEAD, (times[i - 1] + times[i]) / 2)

    firsts = [at(i) for i in sentences]
    spares = [(at(i), math.inf) for i in sentences]
    if cut_clauses:
        spares += [(at(i), times[i] - times[i - 1]) for i in clauses]
    return _choose(firsts, spares, duration, min_piece, min_tail, max_piece)


def parse_word_times(lua_text: str) -> dict:
    """{line name: [seconds, ...]} from a pack's word_times_table.lua."""
    return {name.replace('\\"', '"').replace("\\\\", "\\"): [float(t) for t in times.split()]
            for name, times in _TIMES_ENTRY.findall(lua_text)}


def load_texts(corpus_path: str) -> dict:
    """{file name: text} from a corpus. A name more than one text shares (one quest's id reused,
    say) is left out: which of them the take says is not known."""
    with gzip.open(corpus_path, "rt", encoding="utf-8") as f:
        lines = json.load(f)["lines"]
    texts = collections.defaultdict(set)
    for line in lines:
        if line.get("fileName") and isinstance(line.get("text"), str):
            texts[line["fileName"]].add(line["text"])
    return {name: next(iter(found)) for name, found in texts.items() if len(found) == 1}


def timed_lines(source_pack: str, toc_text: str, corpus_path: str) -> dict:
    """{line name: (text, times)} for the lines of a quests pack that can be cut at their word times."""
    language = re.search(rf"^## {LANGUAGE_KEY}:\s*(\S+)", toc_text, re.MULTILINE)
    if language and language.group(1) != "enUS":
        return {}
    path = os.path.join(source_pack, "generated", WORD_TIMES_FILE)
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        times = parse_word_times(f.read())
    if not times:
        return {}
    texts = load_texts(corpus_path)
    return {name: (texts[name], line_times) for name, line_times in times.items() if name in texts}


def pack_lengths(lengths) -> str:
    """Seconds as the word-times table packs them (pipelines/lib/word-times.mjs): "3.44 .5 12"."""
    out = []
    for seconds in lengths:
        text = f"{seconds:.2f}".rstrip("0").rstrip(".")
        out.append(text[1:] if text.startswith("0.") else text)
    return " ".join(out)


def parse_silences(ffmpeg_log: str):
    """Pairs silencedetect's start and end lines; a pause still open at the end is dropped, since
    a cut there would leave nothing after it."""
    starts = [float(x) for x in _SILENCE_START.findall(ffmpeg_log)]
    ends = [float(x) for x in _SILENCE_END.findall(ffmpeg_log)]
    return [(max(0.0, s), e) for s, e in zip(starts, ends)]


def probe_duration(path: str, settings: Settings) -> float:
    """The line's duration, from its header: nothing is decoded."""
    probe = subprocess.run(
        [settings.ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True)
    return float(probe.stdout.strip())


def measure(path: str, settings: Settings):
    """The line's duration and its pauses, down to the shortest either cut may use."""
    shortest = min(settings.min_pause, settings.fallback_pause or settings.min_pause)
    duration = probe_duration(path, settings)
    detect = subprocess.run(
        [settings.ffmpeg, "-hide_banner", "-nostats", "-i", path, "-af",
         f"silencedetect=noise={settings.noise_db}dB:d={shortest}", "-f", "null", "-"],
        capture_output=True, text=True, check=True)
    return duration, parse_silences(detect.stderr)


def cut(path: str, cuts, out_dir: str, settings: Settings):
    """Writes the pieces as 01.ext, 02.ext, ... into `out_dir` and returns their lengths.

    The lengths come from the segment list, which reports where each cut really fell (a copy
    lands on a packet boundary), rather than from the asked-for times.
    """
    ext = os.path.splitext(path)[1]
    os.makedirs(out_dir, exist_ok=True)
    if settings.mode == "copy":
        codec = ["-c", "copy"]
    elif ext == ".mp3":
        # The Places, Readables and Bosses packs ship 128 kbps CBR.
        codec = ["-c:a", "libmp3lame", "-b:a", "128k"]
    else:
        codec = ["-c:a", "libvorbis", "-q:a", "0"]
    with tempfile.TemporaryDirectory() as scratch:
        listing = os.path.join(scratch, "pieces.csv")
        subprocess.run(
            [settings.ffmpeg, "-v", "error", "-nostdin", "-i", path, "-map", "0:a", *codec,
             # bitexact: the Ogg serial number is otherwise random, so every run would rewrite
             # every piece and each one would be a fresh download.
             "-fflags", "+bitexact", "-flags:a", "+bitexact",
             "-f", "segment", "-segment_times", ",".join(f"{c:.3f}" for c in cuts),
             "-segment_start_number", "1", "-reset_timestamps", "1",
             "-segment_list", listing, "-segment_list_type", "csv",
             os.path.join(out_dir, f"%02d{ext}")],
            check=True)
        with open(listing, newline="") as f:
            rows = list(csv.reader(f))
    return [round(float(end) - float(start), 2) for _, start, end in rows]


def _convert_line(source: str, relative: str, target_sounds: str, settings: Settings, dry_run: bool,
                  name: str, timed=None):
    result = LineResult(name, relative, 0.0, os.path.getsize(source))
    cuts = None
    if timed:
        result.duration = probe_duration(source, settings)
        cuts = choose_timed_cuts(*timed, result.duration, settings.min_piece, settings.min_tail,
                                 settings.max_piece, cut_clauses=bool(settings.fallback_pause))
        if cuts is not None:
            result.method = "times"
    if cuts is None:
        result.duration, silences = measure(source, settings)
        cuts = choose_cuts(silences, result.duration, settings.min_piece, settings.min_tail, settings.min_pause,
                           settings.max_piece, settings.fallback_pause)
    if dry_run:
        bounds = [0.0, *cuts, result.duration]
        result.lengths = [round(b - a, 2) for a, b in zip(bounds, bounds[1:])]
        return result
    if not cuts:
        destination = os.path.join(target_sounds, relative)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
        result.lengths = [round(result.duration, 2)]
        result.bytes_after = result.bytes_before
        return result
    folder = os.path.join(target_sounds, os.path.splitext(relative)[0])
    result.lengths = cut(source, cuts, folder, settings)
    result.bytes_after = sum(os.path.getsize(os.path.join(folder, f)) for f in os.listdir(folder))
    return result


def _sound_files(sounds_dir: str):
    found = []
    for root, _, files in os.walk(sounds_dir):
        for f in files:
            if f.endswith(AUDIO_EXTENSIONS):
                found.append(os.path.relpath(os.path.join(root, f), sounds_dir))
    return sorted(found)


def write_table(path: str, module_name: str, results) -> None:
    rows = sorted((r.name, pack_lengths(r.lengths)) for r in results if r.split)
    with open(path, "w", newline="\n") as f:
        f.write(DATAMODULE_TABLE_GUARD_CLAUSE + "\n")
        f.write(f"{module_name}.{TABLE_NAME} = {{\n")
        for name, lengths in rows:
            f.write(f"    [\"{name}\"] = \"{lengths}\",\n")
        f.write("}\n")


def write_lookup_table(path: str, results) -> None:
    """Adds `pieces = "..."` to each split line's entry in a lookup pack's Data/Sounds.lua."""
    by_key = {r.name: r for r in results if r.split}
    with open(path, newline="") as f:
        text = f.read()
    if text.count('file = "') != len(_LOOKUP_ENTRY.findall(text)):
        raise ValueError(f"{path} has entries not written as 'file = \"...\", len = N'")

    def add_pieces(match):
        key = match.group(2).replace("\\\\", "\\")
        result = by_key.get(key)
        return f'{match.group(1)}, pieces = "{pack_lengths(result.lengths)}"' if result else match.group(1)

    with open(path, "w", newline="") as f:
        f.write(_LOOKUP_ENTRY.sub(add_pieces, text))


def mark_toc(path: str, marker: str) -> None:
    """Marks a lookup pack as converted; its table is the one it already loads."""
    with open(path, newline="") as f:
        text = f.read()
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(newline)
    if marker in lines:
        return
    last_header = max(i for i, line in enumerate(lines) if line.startswith("## "))
    lines.insert(last_header + 1, marker)
    with open(path, "w", newline="") as f:
        f.write(newline.join(lines))


def patch_toc(path: str) -> None:
    """Loads the pieces table after the length table, and marks the pack as converted."""
    with open(path, newline="") as f:
        text = f.read()
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(newline)
    if TOC_MARKER in lines:
        return
    entry = f"generated\\{TABLE_FILE}"
    last_header = max(i for i, line in enumerate(lines) if line.startswith("## "))
    lines.insert(last_header + 1, TOC_MARKER)
    anchor = next((i for i, line in enumerate(lines) if line.strip() == "generated\\sound_length_table.lua"), None)
    if anchor is None:
        while lines and lines[-1] == "":
            lines.pop()
        lines.extend([entry, ""])
    else:
        lines.insert(anchor + 1, entry)
    with open(path, "w", newline="") as f:
        f.write(newline.join(lines))


def convert_pack(source_pack: str, output_root: str, settings: Settings = None, jobs: int = None,
                 limit: int = None, dry_run: bool = False, progress=None, corpus: str = DEFAULT_CORPUS):
    """Converts one pack folder into `output_root/<same name>` and returns a LineResult per line.

    The source is only read. The output folder must not exist yet, so a run never mixes pieces
    from two settings. `corpus` holds the text a quests pack's word times were laid on; None, or the
    default where it is not there, measures every line.
    """
    settings = settings or Settings()
    source_pack = os.path.abspath(source_pack)
    module_name = os.path.basename(source_pack.rstrip(os.sep))
    toc = os.path.join(source_pack, f"{module_name}.toc")
    if os.path.isdir(os.path.join(source_pack, "generated", "sounds")):
        layout, sounds = "quests", os.path.join(source_pack, "generated", "sounds")
    elif os.path.isfile(os.path.join(source_pack, LOOKUP_TABLE)) and os.path.isdir(os.path.join(source_pack, "Sounds")):
        layout, sounds = "lookup", os.path.join(source_pack, "Sounds")
    else:
        layout, sounds = None, None
    if not os.path.isfile(toc) or layout is None:
        raise ValueError(f"{source_pack} is not a sound pack this knows (no {module_name}.toc, "
                         "generated/sounds or Data/Sounds.lua)")
    with open(toc) as f:
        toc_text = f.read()
        if TOC_MARKER in toc_text or LOOKUP_TOC_MARKER in toc_text:
            raise ValueError(f"{source_pack} is already converted")

    files = _sound_files(sounds)
    if layout == "quests":
        # The tables are keyed by name alone, so two folders holding one name cannot both be cut.
        names = {f: os.path.splitext(os.path.basename(f))[0] for f in files}
        counts = collections.Counter(names.values())
        duplicates = sorted(name for name, count in counts.items() if count > 1)
        if duplicates:
            raise ValueError(f"line names repeat across folders: {duplicates[:5]}")
        use_corpus = corpus and (corpus != DEFAULT_CORPUS or os.path.isfile(corpus))
        timed = timed_lines(source_pack, toc_text, corpus) if use_corpus else {}
    else:
        with open(os.path.join(source_pack, LOOKUP_TABLE), newline="") as f:
            table_text = f.read()
        if table_text.count('file = "') != len(_LOOKUP_ENTRY.findall(table_text)):
            # Checked before any cutting: an entry this cannot read would keep pointing at a file
            # that is no longer there.
            raise ValueError(f"{LOOKUP_TABLE} has entries not written as 'file = \"...\", len = N'")
        # A lookup pack names a file by its path under Sounds/, with backslashes, as its entry does.
        names = {f: os.path.splitext(f)[0].replace(os.sep, "\\") for f in files}
        timed = {}
    if limit is not None:
        files = files[:limit]

    target = os.path.join(os.path.abspath(output_root), module_name)
    target_sounds = os.path.join(target, os.path.relpath(sounds, source_pack))
    if not dry_run:
        if os.path.exists(target):
            raise FileExistsError(f"{target} exists; remove it or choose another output folder")

        def leave_out_sounds(directory, entries):
            directory = os.path.abspath(directory)
            if directory == sounds or directory.startswith(sounds + os.sep):
                return [e for e in entries if e.endswith(AUDIO_EXTENSIONS)]
            return []

        shutil.copytree(source_pack, target, ignore=leave_out_sounds)

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs or os.cpu_count() or 4) as pool:
        futures = [pool.submit(_convert_line, os.path.join(sounds, rel), rel, target_sounds, settings, dry_run,
                               names[rel], timed.get(names[rel]))
                   for rel in files]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            if progress:
                progress(len(results), len(files))
    results.sort(key=lambda r: r.relative_path)

    if not dry_run:
        if layout == "quests":
            write_table(os.path.join(target, "generated", TABLE_FILE), module_name, results)
            patch_toc(os.path.join(target, f"{module_name}.toc"))
        else:
            write_lookup_table(os.path.join(target, LOOKUP_TABLE), results)
            mark_toc(os.path.join(target, f"{module_name}.toc"), LOOKUP_TOC_MARKER)
    return results


def summarise(results) -> dict:
    split = [r for r in results if r.split]
    pieces = [length for r in results for length in r.lengths]
    before = sum(r.bytes_before for r in results)
    after = sum(r.bytes_after for r in results)
    return {
        "lines": len(results),
        "lines_split": len(split),
        "lines_timed": sum(1 for r in results if r.method == "times"),
        "files_after": sum(len(r.lengths) for r in results),
        "longest_piece": max(pieces, default=0.0),
        "median_piece": sorted(pieces)[len(pieces) // 2] if pieces else 0.0,
        "bytes_before": before,
        "bytes_after": after,
        "growth": (after / before - 1) if before and after else None,
    }
