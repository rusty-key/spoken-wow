"""Which pack a line belongs in, so the sound pack can ship in pieces.

The whole pack is 600 MB of audio, which is more than CurseForge will take in one upload and
more than most players want for lines their character cannot reach. So it ships five ways: a
pack per side of the war, a pack of the quests both sides can take, a pack of gossip, and one
holding everything for anyone who would rather have a single install.

A pack is an addon folder of its own rather than a second file on one project, because addon
managers install the newest file for a project and would silently move a player from the pack
they chose to whichever was uploaded last. The player needs no change to read them: PrepareSound
walks every registered module and takes the first whose SoundLengthLookupByFileName has the
file, which is how upstream shipped one pack per expansion.

WHICH SIDE A QUEST IS ON IS NOT DERIVED HERE. It is read from two committed files, so building a
pack needs no database. First the Compendium's own data (addons/Spoken_Quests/Data/Compendium.lua,
tools/export_compendium.py): a quest whose `races` are all one side's is that side's. It has
Forever's quests, which the vmangos world DB lacks, and Forever's client's race masks. Then, for
a quest the Compendium does not list, corpus/factions.json, the export tools/export_factions.py
writes from the vmangos world DB; its header explains how a quest gets a side there. Absent
from both means shared, which is the common case.

STEMS, NOT FILENAMES. Everything here talks in 'quests/5-accept' without an extension, because
a staged store holds ogg where the corpus names mp3.
"""
import json
import os
import re

from tts_cli.naming import CHATTER, subfolder_from_line_id

DEFAULT_FACTIONS_PATH = "corpus/factions.json"
DEFAULT_COMPENDIUM_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "addons", "Spoken_Quests", "Data",
    "Compendium.lua"))

#: Each side's races as the Compendium's `races` bits (ChrRaces.PlayableRaceBit): Human, Dwarf,
#: Night Elf, Gnome and High Order Skyborne; Orc, Undead, Tauren, Troll and Windshaper Skyborne.
SIDE_RACES = {"alliance": 1 | 4 | 8 | 64 | 1 << 32, "horde": 2 | 16 | 32 | 128 | 1 << 33}

#: 'all' is every line; the next four partition the same set. 'quests' is every line but gossip
#: - Alliance, Horde and Shared in one - for a language with too few players yet to be worth
#: three quest packs: it ships in that language's Shared folder, so when the language is split
#: later its players keep the folder and add their side (scripts/lib/packs.mjs, `holds: quests`).
PACKS = ("all", "alliance", "horde", "shared", "gossip", "quests")

#: Appended to the module name to make each pack's addon folder. Every pack carries one,
#: including 'all': a bare VoiceOverReduxAudio is the single-format pack that shipped before
#: the split, and leaving the name free stops an old install being half-updated into a new one.
PACK_SUFFIXES = {
    "all": "All",
    "alliance": "Alliance",
    "horde": "Horde",
    "shared": "Shared",
    "gossip": "Gossip",
    "quests": "Quests",
}

#: The half of a title that names the pack. What comes before it is the family - see
#: pack_title - which is a parameter because a set of packs built together is named together.
PACK_LABELS = {
    "all": "All",
    "alliance": "Quests - Alliance",
    "horde": "Quests - Horde",
    "shared": "Quests - Shared",
    "gossip": "Gossip",
    "quests": "Quests",
}

#: The family every pack belongs to unless told otherwise: English's. Another language's is
#: "Spoken <Language> Audio", and its titles come from its pages (scripts/lib/packs.mjs).
DEFAULT_TITLE_FAMILY = "Spoken Audio"


def pack_title(pack: str, family: str = DEFAULT_TITLE_FAMILY) -> str:
    """What the AddOns list shows, which is also what the CurseForge project is called.

    The folder names differ by a suffix nobody reads, and they still carry the name the packs
    were published under, so this is what a player actually tells them apart by.
    """
    return f"{family}: {PACK_LABELS[pack]}"


def compendium_sides(path: str = DEFAULT_COMPENDIUM_PATH) -> dict:
    """{questId: side} for every quest the Compendium lists, None where either side may take it,
    or {} where there is no file to read."""
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        text = f.read()
    quests = text.split("\tquests = {", 1)[-1].split("\tsorts = {", 1)[0]
    sides = {}
    for quest, fields in re.findall(r"^\t\t\[(\d+)\] = \{ (.*) \},$", quests, re.M):
        races = re.search(r"\braces = (\d+)", fields)
        races = int(races.group(1)) if races else 0
        sides[int(quest)] = next((side for side, mask in SIDE_RACES.items()
                                  if races and not races & ~mask), None)
    return sides


def load_sides(path: str = DEFAULT_FACTIONS_PATH, compendium: str = DEFAULT_COMPENDIUM_PATH) -> dict:
    """{questId: 'alliance'|'horde'}: the Compendium's side for each quest it lists, else the
    export's; {} where there is neither to read."""
    sides = {}
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            sides = {int(quest): side for quest, side in json.load(f).get("sides", {}).items()}
    for quest, side in compendium_sides(compendium).items():
        if side:
            sides[quest] = side
        else:
            sides.pop(quest, None)
    return sides


def pack_of_line(line: dict, sides: dict) -> str:
    """The pack a corpus line's audio ships in. NPC chat has no quest to side with, and is an NPC
    talking as gossip is."""
    if line["source"] in ("gossip", CHATTER):
        return "gossip"
    return sides.get(line["questId"], "shared")


def stem_of_line(line: dict) -> str:
    return f'{subfolder_from_line_id(line["lineId"])}/{line["fileName"]}'


def pack_stems(corpus: dict, sides: dict, pack: str, aliases: dict = None) -> set:
    """Every store-relative stem a pack contains.

    A file addressed by lines in two packs is shared, not duplicated and not dropped: being
    generous costs a player megabytes, and being strict costs them a line that never plays.

    `aliases` is GossipAliases ({stem: [stems]}, tts_cli/gossip_text.py): a gossip file's
    aliases ship beside it, since the addon plays one when the file itself has no take, and a
    merged line's file is only reachable that way.
    """
    if pack not in PACKS:
        raise ValueError(f"unknown pack '{pack}' (expected: {', '.join(PACKS)})")

    packs_by_stem = {}
    for line in corpus["lines"]:
        stem = stem_of_line(line)
        found = pack_of_line(line, sides)
        if packs_by_stem.setdefault(stem, found) != found:
            packs_by_stem[stem] = "shared"

    if pack == "all":
        stems = set(packs_by_stem)
    elif pack == "quests":
        stems = {stem for stem, found in packs_by_stem.items() if found != "gossip"}
    else:
        stems = {stem for stem, found in packs_by_stem.items() if found == pack}
    for stem in list(stems):
        folder, name = stem.split("/", 1)
        if folder != "gossip":
            continue
        for alias in (aliases or {}).get(re.sub(r"^[mf]-", "", name), ()):
            stems.update(f"gossip/{prefix}{alias}" for prefix in ("", "m-", "f-"))
    return stems
