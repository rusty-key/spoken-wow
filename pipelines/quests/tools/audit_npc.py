"""Inspect and play the generated voicelines for a given NPC, out of game.

Generated filenames are keyed by quest ID or text hash, never by NPC, so there is no way
to group an NPC's lines from the filesystem alone. This joins the world DB back onto the
installed sound pack to reconstruct that view.

    python tools/audit_npc.py --find dughan            # search NPCs by name
    python tools/audit_npc.py --npc 240                # list that NPC's lines
    python tools/audit_npc.py --npc "Marshal Dughan"   # by exact name
    python tools/audit_npc.py --npc 240 --play         # ...and play them in order
    python tools/audit_npc.py --voice human-male --limit 20 --play

The first run caches the preprocessed dataframe (the full query takes a while); later runs
are instant. Use --refresh after changing the DB or the preprocessing code.
"""
import argparse
import os
import pickle
import subprocess
import sys
import textwrap

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tts_cli.corpus import extraction_rows
from tts_cli.sql_queries import query_dataframe_for_all_quests_and_gossip
from tts_cli.tts_utils import TTSProcessor

SOUNDS = os.environ.get("VOICEOVER_SOUNDS_DIR", (
    "/Applications/World of Warcraft/_classic_era_/Interface/AddOns"
    "/AI_VoiceOverData_Vanilla/generated/sounds"))
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".lines_cache.pkl")


def load_lines(refresh=False):
    if os.path.isfile(CACHE) and not refresh:
        with open(CACHE, "rb") as f:
            return pickle.load(f)
    print("querying world DB (first run only, ~1-2 min) ...", file=sys.stderr)
    quests = query_dataframe_for_all_quests_and_gossip(0)
    df = extraction_rows(quests, quests.iloc[0:0])
    # preprocess_dataframe only touches self for handle_gender_options, so we can skip
    # __init__ and avoid needing an ElevenLabs key just to inspect files.
    df = TTSProcessor.preprocess_dataframe(TTSProcessor.__new__(TTSProcessor), df)
    with open(CACHE, "wb") as f:
        pickle.dump(df, f)
    return df


def filename_for(row):
    """Mirror of TTSProcessor.tts_row naming."""
    name = f'{row["quest"]}-{row["source"]}' if row["quest"] else row["templateText_race_gender_hash"]
    if row["player_gender"] is not None:
        name = row["player_gender"] + "-" + name
    return name


def path_for(row):
    sub = "quests" if row["quest"] else "gossip"
    return os.path.join(SOUNDS, sub, filename_for(row) + ".mp3")


def duration(path):
    try:
        import mutagen.mp3
        return mutagen.mp3.MP3(path).info.length
    except Exception:
        return None


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--npc", help="NPC id, or exact NPC name")
    p.add_argument("--find", help="substring search over NPC names")
    p.add_argument("--voice", help="filter by voice, e.g. human-male")
    p.add_argument("--play", action="store_true", help="play each existing line via afplay")
    p.add_argument("--missing", action="store_true", help="only show lines with no audio file")
    p.add_argument("--limit", type=int, help="cap number of lines shown")
    p.add_argument("--refresh", action="store_true", help="rebuild the cache")
    args = p.parse_args()

    df = load_lines(args.refresh)

    if args.find:
        hits = df[df["name"].str.contains(args.find, case=False, na=False)]
        seen = hits[["id", "name", "type", "race", "gender"]].drop_duplicates("id")
        print(f"{'id':>8}  {'name':<34}{'type':<12}{'voice'}")
        print("-" * 74)
        for r in seen.to_dict("records"):
            print(f"{r['id']:>8}  {r['name']:<34}{r['type']:<12}{r['race']}-{r['gender']}")
        print(f"\n{len(seen)} NPC(s)")
        return

    rows = df
    if args.npc:
        if args.npc.isdigit():
            rows = rows[rows["id"] == int(args.npc)]
        else:
            rows = rows[rows["name"].str.lower() == args.npc.lower()]
    if args.voice:
        rows = rows[rows["voice_name"] == args.voice]
    if not args.npc and not args.voice:
        p.error("give --npc, --voice, or --find")

    # Match what the generator would actually have produced.
    rows = rows[rows["source"] != "progress"]
    rows = rows[~rows["cleanedText"].str.contains(r"[$<>]", regex=True, na=False)]
    rows = rows.drop_duplicates(subset=["source", "quest", "templateText_race_gender_hash",
                                        "player_gender"])
    if rows.empty:
        print("no generatable lines found")
        return

    records = rows.to_dict("records")
    records.sort(key=lambda r: (r["name"], r["source"], str(r["quest"])))

    npc_names = {r["name"] for r in records}
    header = next(iter(npc_names)) if len(npc_names) == 1 else f"{len(npc_names)} NPCs"
    voices = sorted({r["voice_name"] for r in records})
    print(f"\n{header}   voice(s): {', '.join(voices)}")
    if len(voices) > 1:
        print("  NOTE: more than one voice across these lines")
    print("=" * 78)

    shown = present = 0
    for r in records:
        if args.limit and shown >= args.limit:
            break
        path = path_for(r)
        exists = os.path.isfile(path)
        if args.missing and exists:
            continue
        shown += 1
        present += exists
        tag = r["source"] if not r["quest"] else f'{r["source"]} q{r["quest"]}'
        d = duration(path) if exists else None
        mark = f"{d:5.1f}s" if d else ("  --  " if exists else "MISSING")
        title = f'  [{r["quest_title"]}]' if r["quest_title"] else ""
        print(f"\n{mark}  {tag}{title}")
        print(f"        {os.path.basename(path)}")
        body = " ".join(r["cleanedText"].split())
        for line in textwrap.wrap(body, 68)[:4]:
            print(f"        | {line}")
        if exists and args.play:
            print("        playing ...", flush=True)
            subprocess.run(["afplay", path])

    print("\n" + "=" * 78)
    print(f"{shown} line(s), {present} with audio present")
    if not args.play and present:
        print("re-run with --play to listen in order")


if __name__ == "__main__":
    main()
