"""The English clips to time: one row per recording, with the words it was voiced from.

    py -3 manifest.py --addons <the game's AddOns folder> --out manifest.jsonl

Rows are {family, id, audio, text}. `family` is the addon source that plays the clip (quests,
gossip, zones, books), `id` the file name the addon looks the clip up by (Spoken_Quests'
`fileName`, a zone's `file`, a book page's `file`) and `text` what the voice was given.
"""
import argparse
import gzip
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CORPUS = os.path.join(REPO, "pipelines", "quests", "corpus", "corpus.json.gz")
ZONES_DATA = os.path.join(REPO, "addons", "Spoken_Zones", "Data", "enUS")

# A corpus line's id says which family of file it is; follow-ups are played by the quests source.
CORPUS_FAMILY = {"q": ("quests", "quests"), "g": ("gossip", "gossip"), "f": ("quests", "followup")}


def lua_json(*args):
    out = subprocess.run(["luajit", os.path.join(HERE, "dump.lua"), *args], check=True, capture_output=True)
    return json.loads(out.stdout.decode("utf8"))


def installed_quest_audio(addons):
    """(folder, stem) -> path of every quest-pack recording installed under `addons`."""
    found = {}
    for pack in sorted(os.listdir(addons)):
        if not pack.startswith("SpokenQuestsAudio"):
            continue
        sounds = os.path.join(addons, pack, "generated", "sounds")
        if not os.path.isdir(sounds):
            continue
        for folder in os.listdir(sounds):
            for name in os.listdir(os.path.join(sounds, folder)):
                stem, ext = os.path.splitext(name)
                if ext == ".ogg":
                    found.setdefault((folder, stem), os.path.join(sounds, folder, name))
    return found


def text_of(folder, stem, texts, voices):
    """The words a recording was voiced from: its own line's, or its base line's for the same
    words read in another voice (`<base>-<voice>`, naming.py). None when the corpus has neither."""
    if (folder, stem) in texts:
        return texts[(folder, stem)]
    for voice in voices:
        if stem.endswith("-" + voice) and (folder, stem[: -len(voice) - 1]) in texts:
            return texts[(folder, stem[: -len(voice) - 1])]
    return None


def corpus_rows(addons):
    audio = installed_quest_audio(addons)
    corpus = json.load(gzip.open(CORPUS, "rt", encoding="utf8"))
    texts, voices = {}, set()
    for line in corpus["lines"]:
        voices.add(line["voice"])
        folder = CORPUS_FAMILY[line["lineId"].split(":")[0]][1]
        # A file shared by NPCs was voiced from its first speaker's words.
        if line.get("text"):
            texts.setdefault((folder, line["fileName"]), line["text"])
    voices.update(npc["voice"] for npc in corpus.get("npcs", []) if npc.get("voice"))
    voices = sorted(voices, key=len, reverse=True)
    family_of = {folder: family for family, folder in CORPUS_FAMILY.values()}
    rows = []
    for (folder, stem), path in sorted(audio.items()):
        text = text_of(folder, stem, texts, voices)
        if text:
            rows.append({"family": family_of[folder], "id": stem, "audio": path, "text": text})
    return rows


def books_rows(addons):
    pack = lua_json("pack", os.path.join(addons, "SpokenBooksAudio", "Data", "Sounds.lua"),
                    "SpokenBooksAudioPacks", "SpokenBooksAudio")
    rows = []
    for page in pack["pages"].values():
        path = os.path.join(addons, "SpokenBooksAudio", "Sounds", page["file"] + ".mp3")
        if page.get("text") and os.path.exists(path):
            rows.append({"family": "books", "id": page["file"], "audio": path, "text": page["text"]})
    return rows


def zones_rows(addons):
    pack = lua_json("pack", os.path.join(addons, "SpokenZonesAudio", "Data", "Sounds.lua"),
                    "SpokenZonesAudioPacks", "SpokenZonesAudio")
    zones = lua_json("lore", os.path.join(ZONES_DATA, "Zones.lua"))
    subzones = lua_json("lore", os.path.join(ZONES_DATA, "Subzones.lua"))
    entries = [(clip, zones.get(map_id)) for map_id, clip in pack["zones"].items()]
    for map_id, areas in pack["subzones"].items():
        entries += [(clip, subzones.get(map_id, {}).get(area)) for area, clip in areas.items()]
    rows = []
    for clip, lore in entries:
        path = os.path.join(addons, "SpokenZonesAudio", "Sounds", clip["file"].replace("\\", os.sep) + ".mp3")
        if lore and lore.get("full") and os.path.exists(path):
            rows.append({"family": "zones", "id": clip["file"], "audio": path, "text": lore["full"]})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--addons", required=True, help="the game's Interface/AddOns folder")
    parser.add_argument("--out", default="manifest.jsonl")
    args = parser.parse_args()
    rows = corpus_rows(args.addons) + books_rows(args.addons) + zones_rows(args.addons)
    with open(args.out, "w", encoding="utf8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    counts = {}
    for row in rows:
        counts[row["family"]] = counts.get(row["family"], 0) + 1
    print(len(rows), "clips:", counts)


if __name__ == "__main__":
    main()
