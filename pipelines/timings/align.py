"""When each word of a recording starts, found by listening to it.

    py -3 align.py --manifest manifest.jsonl --out aligned.jsonl [--family quests] [--limit 50]

Two engines. `whisperx` (the default) is forced alignment: the text the voice was given is laid
over the recording by a wav2vec2 phoneme model, so no word is heard wrongly and the times come
from the sound itself. `whisper` is faster-whisper: it hears the recording with word timestamps
and the words it heard are matched to the words the voice was given. Either way every word of the
text ends up with a start time in seconds, and a word that got none is placed between its
neighbours. Rows already in --out are skipped, so the run can be stopped and started again.

Each output row is {family, id, length, words, matched, t}: `t` has one start time per word of
the text, cut as the addon cuts it (Spoken:CaptionWords), and `matched` is the share of the
words the model heard as written. Low `matched` rows are left out of the shipped data.
"""
import argparse
import difflib
import glob
import json
import os
import random
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from current import unchanged

# The addon splits on Lua's whitespace, which is narrower than Python's str.split().
TOKEN = re.compile(r"[^ \t\n\r\f\v]+")


def caption_words(text):
    return TOKEN.findall(text)


def normal(word):
    return re.sub(r"[^a-z0-9']", "", word.lower().replace("’", "'"))


def align_words(words, heard, length):
    """Start time per word of `words`, from `heard`: (word, start, end) as the model heard them.

    Returns (times, matched). Words heard as written take the model's start; the rest are spread
    evenly between the heard words around them. Times never go backwards and stay inside the
    recording.
    """
    known = [normal(w) for w in words]
    spoken = [normal(h[0]) for h in heard]
    starts = [None] * len(words)
    exact = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, known, spoken, autojunk=False).get_opcodes():
        # A stretch both sides cut into the same number of words is read word for word.
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for k in range(i2 - i1):
                starts[i1 + k] = heard[j1 + k][1]
        if tag == "equal":
            exact += i2 - i1
    anchored = [i for i, s in enumerate(starts) if s is not None]
    if not anchored:
        return None, 0.0
    end = heard[-1][2] if heard else length
    for i, start in enumerate(starts):
        if start is not None:
            continue
        before = max((k for k in anchored if k < i), default=None)
        after = min((k for k in anchored if k > i), default=None)
        if before is None:
            starts[i] = starts[after] * i / after if after else 0.0
        elif after is None:
            starts[i] = starts[before] + (end - starts[before]) * (i - before) / (len(starts) - before)
        else:
            starts[i] = starts[before] + (starts[after] - starts[before]) * (i - before) / (after - before)
    times, last = [], 0.0
    for start in starts:
        last = max(last, min(start, length - 0.01))
        times.append(round(last, 2))
    return times, exact / len(words)


def load_model(name):
    from faster_whisper import WhisperModel
    # ctranslate2 does not look in the pip packages for the CUDA libraries on Windows.
    site = os.path.join(os.path.dirname(os.__file__), "site-packages", "nvidia")
    for sub in ("cublas", "cudnn", "cuda_nvrtc"):
        folder = os.path.join(site, sub, "bin")
        if os.path.isdir(folder):
            os.add_dll_directory(folder)
            os.environ["PATH"] = folder + os.pathsep + os.environ["PATH"]
    try:
        model = WhisperModel(name, device="cuda", compute_type="float16")
        # The CUDA libraries load on first use, so a second of silence finds a missing one now.
        import numpy
        list(model.transcribe(numpy.zeros(16000, dtype=numpy.float32), language="en")[0])
        return model, "cuda"
    except Exception as problem:
        print("no GPU (%s); using the CPU" % str(problem)[:80], file=sys.stderr)
        return WhisperModel(name, device="cpu", compute_type="int8"), "cpu"


def hear(model, path, prompt=None):
    # `prompt` is the text the voice was given: it biases the model toward the names and spellings
    # in it, which is what it gets wrong on its own (Thrall, Ner'zhul, numerals).
    segments, info = model.transcribe(path, language="en", word_timestamps=True, initial_prompt=prompt,
                                      condition_on_previous_text=False, beam_size=5)
    return [(w.word, w.start, w.end) for s in segments for w in s.words], info.duration


def load_whisperx(language="en"):
    """The wav2vec2 alignment model for `language` (WhisperX), on the GPU where there is one."""
    import torch
    import whisperx
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("no GPU; using the CPU", file=sys.stderr)
    model, metadata = whisperx.load_align_model(language_code=language, device=device)
    return (model, metadata), device


def heard_from_alignment(words):
    """(word, start, end) for the words of a WhisperX alignment that got a time.

    WhisperX gives every whitespace-separated word of the text it was handed, and leaves the
    time off one it cannot place: a numeral, a symbol. Those are the ones align_words fills in.
    """
    return [(w["word"], w["start"], w["end"]) for w in words if "start" in w and "end" in w]


def force_align(aligner, device, path, text):
    """The words of `text` laid over the recording at `path`: ([(word, start, end)], length)."""
    import whisperx
    model, metadata = aligner
    audio = whisperx.load_audio(path)
    length = len(audio) / 16000
    # One line of single-spaced words, so its words are the ones the addon cuts (caption_words).
    line = " ".join(caption_words(text))
    result = whisperx.align([{"text": line, "start": 0.0, "end": length}], model, metadata, audio, device,
                            return_char_alignments=False)
    words = [w for segment in result["segments"] for w in segment["words"]]
    return heard_from_alignment(words), length


# Below this share of words placed as written, a recording's times are not kept (export.py's cut).
MIN_MATCHED = 0.85


def align_clip(path, text, language="en", min_matched=MIN_MATCHED):
    """One recording's word times as export.encode writes them, with the share matched, or None.

    For a take just generated: the site calls this (`--clip`) when the generator gave no times.
    """
    from export import encode
    aligner, device = load_whisperx(language)
    heard, length = force_align(aligner, device, path, text)
    words = caption_words(text)
    times, matched = align_words(words, heard, length) if heard and words else (None, 0.0)
    packed = encode(times) if times and matched >= min_matched else None
    return (packed, matched) if packed else None


def prune(out, manifest_rows):
    """Remove from --out and its shards the rows of recordings that are now a different length: a
    pack update re-cut them, so their times no longer fit."""
    current = {(r["family"], r["id"]): r["audio"] for r in manifest_rows}
    for path in [out] + sorted(glob.glob(out + ".*")):
        if not os.path.exists(path):
            continue
        keep, dropped = [], 0
        for line in open(path, encoding="utf8"):
            row = json.loads(line)
            if unchanged(row, current.get((row["family"], row["id"]))):
                keep.append(line)
            else:
                dropped += 1
        with open(path, "w", encoding="utf8", newline="\n") as handle:
            handle.writelines(keep)
        print(path, "kept", len(keep), "dropped", dropped)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--manifest")
    parser.add_argument("--out")
    parser.add_argument("--clip", metavar="AUDIO",
                        help="time this one recording (WhisperX) against the text in --text-file and print "
                             "{times, matched} as one JSON line; exit 1 when it matched too little to keep")
    parser.add_argument("--text-file", help="--clip: the text the voice was given, as UTF-8")
    parser.add_argument("--family", action="append", help="only these families (repeatable)")
    parser.add_argument("--limit", type=int, help="only this many clips, picked at random")
    parser.add_argument("--shard", help="I/N: do every Nth clip from the Ith, into --out.I; run N at once")
    parser.add_argument("--known", action="append", default=[],
                        help="a glob of earlier results to skip as done (repeatable), besides --out's")
    parser.add_argument("--engine", choices=("whisperx", "whisper"), default="whisperx",
                        help="whisperx: force-align the text over the recording (default); "
                             "whisper: hear it with faster-whisper and match what it heard")
    parser.add_argument("--language", default="en", help="the recordings' language, for WhisperX's model")
    parser.add_argument("--model", default="small.en", help="the faster-whisper model (--engine whisper)")
    parser.add_argument("--prompt", action="store_true", help="--engine whisper: give the model the text as its prompt")
    parser.add_argument("--retry-below", type=float, metavar="MATCHED",
                        help="only recordings whose best row in --known matched less than this; their "
                             "rows go to --out, and what --out holds is what is done")
    parser.add_argument("--prune", action="store_true",
                        help="drop rows whose recording has changed length since (run with no worker going)")
    args = parser.parse_args()

    if args.clip:
        if not args.text_file:
            parser.error("--clip needs --text-file")
        with open(args.text_file, encoding="utf8") as handle:
            found = align_clip(args.clip, handle.read(), args.language)
        if not found:
            sys.exit(1)
        print(json.dumps({"times": found[0], "matched": round(found[1], 3)}), flush=True)
        return
    if not args.manifest or not args.out:
        parser.error("--manifest and --out are required")

    rows = [json.loads(line) for line in open(args.manifest, encoding="utf8")]
    if args.prune:
        prune(args.out, rows)
        return
    if args.family:
        rows = [r for r in rows if r["family"] in args.family]
    # Whatever --out, its shards and --known already hold is done, unless its recording has been
    # cut again since: a row counts only while its length is still the recording's.
    audio = {(r["family"], r["id"]): r["audio"] for r in rows}
    done, stale, best = set(), 0, {}
    paths = [args.out] + glob.glob(args.out + ".*") + [p for pattern in args.known for p in glob.glob(pattern)]
    if args.retry_below is not None:
        # A second look at the weak ones: what --known holds only says which they are.
        for pattern in args.known:
            for path in glob.glob(pattern):
                for line in open(path, encoding="utf8"):
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    key = (row["family"], row["id"])
                    best[key] = max(best.get(key, 0.0), row["matched"])
        paths = [args.out] + glob.glob(args.out + ".*")
    for path in dict.fromkeys(paths):
        if os.path.exists(path):
            for line in open(path, encoding="utf8"):
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                key = (row["family"], row["id"])
                if key not in audio:
                    continue
                if unchanged(row, audio[key]):
                    done.add(key)
                else:
                    stale += 1
    rows = [r for r in rows if (r["family"], r["id"]) not in done]
    if args.retry_below is not None:
        rows = [r for r in rows if best.get((r["family"], r["id"]), 1.0) < args.retry_below]
    out_path = args.out
    if args.shard:
        index, count = (int(n) for n in args.shard.split("/"))
        rows = rows[index::count]
        out_path = "%s.%d" % (args.out, index)
    if args.limit:
        random.Random(1).shuffle(rows)
        rows = rows[:args.limit]
    print(len(done), "done,", stale, "stale (recut since),", len(rows), "to do", flush=True)

    if args.engine == "whisperx":
        model, device = load_whisperx(args.language)

        def listen(row):
            return force_align(model, device, row["audio"], row["text"])
        label = "whisperx-" + args.language
    else:
        model, device = load_model(args.model)

        def listen(row):
            return hear(model, row["audio"], row["text"][:900] if args.prompt else None)
        label = args.model
    started = time.time()
    with open(out_path, "a", encoding="utf8", newline="\n") as out:
        for n, row in enumerate(rows, 1):
            words = caption_words(row["text"])
            try:
                heard, length = listen(row)
            except Exception as problem:
                print("FAILED", row["family"], row["id"], str(problem)[:120], flush=True)
                continue
            times, matched = align_words(words, heard, length) if heard and words else (None, 0.0)
            if times is None:
                print("UNHEARD", row["family"], row["id"], flush=True)
                continue
            out.write(json.dumps({"family": row["family"], "id": row["id"], "length": round(length, 3),
                                  "bytes": os.path.getsize(row["audio"]), "words": len(words),
                                  "matched": round(matched, 3), "model": label, "prompt": args.prompt,
                                  "t": times}) + "\n")
            out.flush()
            if n % 100 == 0:
                rate = n / (time.time() - started)
                print("%d/%d  %.1f clips/s  ~%.0f min left" % (n, len(rows), rate, (len(rows) - n) / rate / 60),
                      flush=True)
    print("finished", flush=True)


if __name__ == "__main__":
    main()
