"""Cut finished quests packs into sentence pieces, so a stopped line can resume from its sentence.

    python tools/split_pieces.py dist/SpokenQuestsAudioAlliance out/
    python tools/split_pieces.py --dry-run --limit 200 <pack>      # how it would cut, writing nothing

Each pack given is read, never changed, and its converted copy is written to OUTPUT/<pack name>.
A line with word times in its pack and its text in the corpus is cut at its sentences' first
words without being measured; every other line is cut at its pauses.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tts_cli import pieces  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("packs", nargs="+", help="pack folders, then the output folder (omit it with --dry-run)")
    parser.add_argument("--mode", choices=("copy", "encode"), default="copy",
                        help="copy the packets (default, lossless) or re-encode each piece (smaller)")
    parser.add_argument("--min-pause", type=float, default=pieces.DEFAULT_MIN_PAUSE)
    parser.add_argument("--noise-db", type=float, default=pieces.DEFAULT_NOISE_DB)
    parser.add_argument("--min-piece", type=float, default=pieces.DEFAULT_MIN_PIECE)
    parser.add_argument("--min-tail", type=float, default=pieces.DEFAULT_MIN_TAIL)
    parser.add_argument("--max-piece", type=float, default=pieces.DEFAULT_MAX_PIECE)
    parser.add_argument("--fallback-pause", type=float, default=pieces.DEFAULT_FALLBACK_PAUSE,
                        help="shortest pause a too-long piece may be cut at again (0: never)")
    parser.add_argument("--corpus", default=pieces.DEFAULT_CORPUS,
                        help="the corpus whose text the word times were laid on (default: this checkout's)")
    parser.add_argument("--no-word-times", action="store_true", help="measure every line, times or not")
    parser.add_argument("--jobs", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None, help="only the first N lines of each pack")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", help="write the summary as JSON here")
    args = parser.parse_args(argv)

    if args.dry_run:
        sources, output = args.packs, None
    else:
        if len(args.packs) < 2:
            parser.error("give at least one pack and an output folder")
        sources, output = args.packs[:-1], args.packs[-1]

    settings = pieces.Settings(min_pause=args.min_pause, noise_db=args.noise_db, min_piece=args.min_piece,
                               min_tail=args.min_tail, max_piece=args.max_piece,
                               fallback_pause=args.fallback_pause, mode=args.mode)
    report = {}
    for source in sources:
        name = os.path.basename(os.path.abspath(source))

        def progress(done, total):
            if done % 250 == 0 or done == total:
                print(f"\r{name}: {done}/{total}", end="", file=sys.stderr, flush=True)

        results = pieces.convert_pack(source, output or ".", settings, jobs=args.jobs, limit=args.limit,
                                      dry_run=args.dry_run, progress=progress,
                                      corpus=None if args.no_word_times else args.corpus)
        print(file=sys.stderr)
        summary = pieces.summarise(results)
        report[name] = summary
        growth = summary["growth"]
        print(f"{name}: {summary['lines']} lines ({summary['lines_timed']} by word times), "
              f"{summary['lines_split']} split, "
              f"{summary['files_after']} files after; median piece {summary['median_piece']:.1f} s, "
              f"longest {summary['longest_piece']:.1f} s"
              + (f"; {summary['bytes_before'] / 1e6:.1f} MB -> {summary['bytes_after'] / 1e6:.1f} MB "
                 f"({growth:+.1%})" if growth is not None else ""))
    if args.report:
        with open(args.report, "w") as f:
            json.dump({"settings": vars(settings), "packs": report}, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
