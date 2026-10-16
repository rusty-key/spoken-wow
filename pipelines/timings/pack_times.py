"""Puts the measured word times into a voice pack: its Data/WordTimes.lua and the line in its .toc.

    py -3 pack_times.py --times word-times.json <pack folder> [<pack folder> ...]

The data file holds the times of the recordings that are in that pack, found by the files under
it: a quest pack's generated/sounds/<quests|gossip|followup>/<name>.ogg, a Readables or Places
pack's Sounds/<file>.mp3. A pack with no recording that has times is left as it was. Packs built
by pipelines/quests/tts_cli/build.py and the books and zones package scripts call this, so the
times travel with the voice, and Spoken only reads the table the data file fills.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from export import render_lua

# generated/sounds/<folder> of a quest pack -> the source that plays it.
QUEST_FOLDERS = {"quests": "quests", "followup": "quests", "gossip": "gossip"}
DATA = os.path.join("Data", "WordTimes.lua")
TOC_LINE = "Data\\WordTimes.lua"


def recordings(pack):
    """[(family, id)] for every recording found in the pack folder."""
    found = []
    sounds = os.path.join(pack, "generated", "sounds")
    if os.path.isdir(sounds):
        for folder, family in QUEST_FOLDERS.items():
            where = os.path.join(sounds, folder)
            if os.path.isdir(where):
                found += [(family, os.path.splitext(name)[0]) for name in os.listdir(where) if name.endswith(".ogg")]
    plain = os.path.join(pack, "Sounds")
    if os.path.isdir(plain):
        family = "books" if "Books" in os.path.basename(pack) or "Readables" in os.path.basename(pack) else "zones"
        for root, _, names in os.walk(plain):
            for name in names:
                if name.endswith(".mp3"):
                    rel = os.path.relpath(os.path.join(root, name), plain)
                    found.append((family, os.path.splitext(rel)[0].replace(os.sep, "\\")))
    return found


def add_toc_line(toc):
    """Lists the data file in the .toc, ahead of the first file it already lists."""
    text = open(toc, encoding="utf8", newline="").read()
    if TOC_LINE in text:
        return
    eol = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(eol)
    for index, line in enumerate(lines):
        if line.strip() and not line.startswith("#"):
            lines.insert(index, TOC_LINE)
            break
    else:
        lines += [TOC_LINE, ""]
    open(toc, "w", encoding="utf8", newline="").write(eol.join(lines))


def add_to_pack(pack, times):
    """Writes the pack's data file and lists it. Returns how many recordings it holds times for."""
    kept = {}
    for family, ident in recordings(pack):
        packed = times.get(family, {}).get(ident)
        if packed:
            kept.setdefault(family, {})[ident] = packed
    count = sum(len(v) for v in kept.values())
    if not count:
        return 0
    os.makedirs(os.path.join(pack, "Data"), exist_ok=True)
    with open(os.path.join(pack, DATA), "w", encoding="utf8", newline="\n") as handle:
        handle.write(render_lua(kept))
    tocs = [name for name in os.listdir(pack) if name.endswith(".toc")]
    for name in tocs:
        add_toc_line(os.path.join(pack, name))
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--times", required=True, help="the word-times.json export.py wrote")
    parser.add_argument("packs", nargs="+", help="voice pack folders")
    args = parser.parse_args()
    times = json.load(open(args.times, encoding="utf8"))
    for pack in args.packs:
        print("%-40s %d recordings with times" % (os.path.basename(os.path.normpath(pack)), add_to_pack(pack, times)))


if __name__ == "__main__":
    main()
