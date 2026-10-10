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

WHICH SIDE A QUEST IS ON IS NOT DERIVED HERE. corpus/factions.json is the export, written by
tools/export_factions.py from the world DB and committed beside the corpus the way
corpus/ignored.json is - so building a pack needs no database. Its header explains how a quest
gets a side. Absent from that file means shared, which is the common case.

STEMS, NOT FILENAMES. Everything here talks in 'quests/5-accept' without an extension, because
a staged store holds ogg where the corpus names mp3.
"""
import json
import os
import re

from tts_cli.naming import subfolder_from_line_id

DEFAULT_FACTIONS_PATH = "corpus/factions.json"

#: 'all' is every line; the other four partition the same set.
PACKS = ("all", "alliance", "horde", "shared", "gossip")

#: Appended to the module name to make each pack's addon folder. Every pack carries one,
#: including 'all': a bare VoiceOverReduxAudio is the single-format pack that shipped before
#: the split, and leaving the name free stops an old install being half-updated into a new one.
PACK_SUFFIXES = {
    "all": "All",
    "alliance": "Alliance",
    "horde": "Horde",
    "shared": "Shared",
    "gossip": "Gossip",
}

#: The half of a title that names the pack. What comes before it is the family - see
#: pack_title - which is a parameter because a set of packs built together is named together.
PACK_LABELS = {
    "all": "All",
    "alliance": "Alliance",
    "horde": "Horde",
    "shared": "Shared Quests",
    "gossip": "Gossip",
}

#: The family every pack belongs to unless told otherwise, which is every shipping build.
DEFAULT_TITLE_FAMILY = "Spoken Quests Audio"


def pack_title(pack: str, family: str = DEFAULT_TITLE_FAMILY) -> str:
    """What the AddOns list shows, which is also what the CurseForge project is called.

    The folder names differ by a suffix nobody reads, and they still carry the name the packs
    were published under, so this is what a player actually tells them apart by.
    """
    return f"{family}: {PACK_LABELS[pack]}"


def load_sides(path: str = DEFAULT_FACTIONS_PATH) -> dict:
    """The export as {questId: 'alliance'|'horde'}, or {} where there is none to read."""
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        document = json.load(f)
    return {int(quest): side for quest, side in document.get("sides", {}).items()}


def pack_of_line(line: dict, sides: dict) -> str:
    """The pack a corpus line's audio ships in."""
    if line["source"] == "gossip":
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

    stems = set(packs_by_stem) if pack == "all" else \
        {stem for stem, found in packs_by_stem.items() if found == pack}
    for stem in list(stems):
        folder, name = stem.split("/", 1)
        if folder != "gossip":
            continue
        for alias in (aliases or {}).get(re.sub(r"^[mf]-", "", name), ()):
            stems.update(f"gossip/{prefix}{alias}" for prefix in ("", "m-", "f-"))
    return stems
