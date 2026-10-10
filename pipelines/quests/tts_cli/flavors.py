"""
Which of a race and gender's several voices an NPC actually speaks with.

Every playable race-gender has two or three distinct NPC voice sets - nightelf-male is
standard, warrior and official; orc-female is standard, shaman and warrior - recorded by
different actors. The game picks between them per NPC: a creature's display info carries an
NPCSoundID, that row names four SoundEntries, and those entries are called things like
`DwarfFemaleMaternalNPCGreetings`. The personality in the middle is the flavor.

The point is that each flavor gets a voice of its own: two NPCs the game voices differently -
a dwarf guard and a grim dwarf - should not end up sounding the same here, so every flavor
is a separate voice slot rather than one voice per race-gender.

This module turns those names into flavor tokens and decides what to do where the game data
does not answer. It deliberately knows nothing about dataframes or SQL so that the rules can
be tested on their own.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Iterable, Mapping

from tts_cli.naming import FOLLOWUP, followup_stem

# The sound entry names spell undead "Undead"; the corpus and the voice slots use the
# client's internal race name.
RACE_TO_SLOT = {
    "Human": "human",
    "Dwarf": "dwarf",
    "NightElf": "nightelf",
    "Gnome": "gnome",
    "Orc": "orc",
    "Troll": "troll",
    "Tauren": "tauren",
    "Undead": "scourge",
    "Scourge": "scourge",
    "Goblin": "goblin",
}

# `<Race><Gender><Flavor>[Vendor]NPC<Kind>`, e.g. DwarfFemaleMaternalNPCGreetings.
#
# The optional `Vendor` is load-bearing: DwarfMaleGrimVendorNPCGreetings is the *same* actor
# as DwarfMaleGrimNPCGreetings reading shopkeeper lines, so leaving it attached would invent
# ten flavors that no voice clips exist for. The flavor group is non-greedy so `Vendor` wins
# the tail rather than being swallowed.
#
# Nothing is matched after `NPC`, because vmangos stores sound_entries.name truncated to 31
# characters: `DwarfMaleStandardVendorNPCGreet`, `NightElfFemalePriestessNPCGreet`. Anchoring
# on the kind would silently drop every name long enough to be cut, which is all of the
# vendor variants. Requiring the literal `NPC` is filter enough - it matches 207 of the 1,197
# sound entries that begin with a race and gender, and yields exactly 52 flavors.
SOUND_NAME = re.compile(
    r"^(?P<race>" + "|".join(RACE_TO_SLOT) + r")"
    r"(?P<gender>Male|Female)"
    r"(?P<flavor>[A-Za-z]+?)"
    r"(?:Vendor)?"
    r"NPC"
)


def flavor_from_sound_name(name: str | None, race_gender: str | None = None) -> str | None:
    """The flavor token in a SoundEntries name, or None if it does not name an NPC voice.

    Most sound entries are combat and ambience, and monster voices (murlocs, kobolds) have
    no flavor at all - they are simply not this shape.

    Given a race-gender, the sound must belong to it. A handful of NPCs are wired to another
    race's voice set entirely: Vethsera is a night elf who greets you in the human female
    official voice, Sha'ni Proudtusk a troll using the tauren female shaman one. Taking the
    bare flavor across would invent a nightelf-female-official that no actor ever recorded,
    so those NPCs are left unresolved and pick up their own race-gender's default instead.
    """
    if not name:
        return None
    match = SOUND_NAME.match(name)
    if not match:
        return None
    own = f"{RACE_TO_SLOT[match.group('race')]}-{match.group('gender').lower()}"
    if race_gender is not None and own != race_gender:
        return None
    return match.group("flavor").lower()


def fallback_flavors(resolved: Iterable[tuple[str, str | None]]) -> dict[str, str]:
    """Per race-gender, the flavor to give NPCs the game data does not answer for.

    Around a tenth of speaking NPCs are hand-made displays with no NPCSoundID - Cairne
    Bloodhoof, Jaina, Archbishop Benedictus. They still need a voice, and the honest default
    is the race-gender's ordinary one.

    "Standard" where it exists, and otherwise the busiest flavor rather than a hardcoded
    name: four race-genders (dwarf-female, goblin-female, goblin-male, tauren-male) have no
    standard voice in the game at all, so a constant would leave them pointing at nothing.
    Derived from the data being processed, so it stays true if the dump changes.
    """
    counts: dict[str, Counter] = {}
    for race_gender, flavor in resolved:
        if flavor:
            counts.setdefault(race_gender, Counter())[flavor] += 1

    # Sort by count then name so a tie does not depend on dict ordering.
    return {
        race_gender: "standard" if "standard" in tally else
        min(tally.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        for race_gender, tally in counts.items()
    }


def consensus_flavor(flavors: Iterable[str | None]) -> str | None:
    """One flavor for a set of NPCs that must share a single audio file.

    A gossip file is named md5(text + race + gender) and a quest file after the quest, so
    NPCs sharing a line share one mp3 - and 468 gossip lines are shared by NPCs of the same
    race and gender but different flavors. Since there is one file there can only be one
    voice, so the group takes its most common flavor. Ties break alphabetically, so the
    choice does not drift between runs.

    The alternative, putting the flavor into the filename, would rename thousands of
    existing files and orphan the audio already generated for them. See tts_cli/naming.py
    for why a filename is not free to change.
    """
    tally = Counter(f for f in flavors if f)
    if not tally:
        return None
    return min(tally.items(), key=lambda kv: (-kv[1], kv[0]))[0]


#: A voice keyed by the creature's model rather than by a humanoid race: `model-{ModelID}`.
MODEL_VOICE = re.compile(r"^model-\d+$")


def model_voice(model_id) -> str:
    """The voice slot of a creature with no humanoid display, e.g. 'model-29'.

    A creature whose display has no CreatureDisplayInfoExtra has no race or sex to pick a
    voice by - Kum'isha is a Broken, the OOX robots are robots - so the model it is drawn with
    names the voice instead, and every NPC on one model shares it. The slot is carried as the
    row's *race* with no flavor, and voice_name answers the race alone for it, so the corpus's
    race-gender-flavor columns need no new one and the voice comes out bare: a follow-up file is
    `{broadcastTextID}-model-29` and a gossip hash is taken over it (tts_cli/naming.py), frozen
    once shipped like every other.

    int() because the id reaches here from a DataFrame column that is NaN on every other row.
    """
    return f"model-{int(model_id)}"


def is_model_voice(name: str | None) -> bool:
    return bool(name) and MODEL_VOICE.match(name) is not None


def voice_name(race: str, gender: str, flavor: str | None) -> str:
    """The ElevenLabs voice name for a race, gender and flavor.

    Two parts when there is no flavor: narrator-male is a pseudo-race for gameobjects, and
    races outside vanilla (a bloodelf model used for Sylvanas) have no NPC voice sets. One
    part for a model slot (model_voice): its gender is a placeholder the schema needs, not
    something the game said, so it stays out of the name.
    """
    if is_model_voice(race):
        return race
    return f"{race}-{gender}-{flavor}" if flavor else f"{race}-{gender}"


def apply_fallbacks(
    race_genders: Iterable[str],
    flavors: Iterable[str | None],
    fallbacks: Mapping[str, str],
) -> list[str | None]:
    """Fill in every unresolved flavor from its race-gender's fallback."""
    return [
        flavor or fallbacks.get(race_gender)
        for race_gender, flavor in zip(race_genders, flavors)
    ]


def file_key(source: str, quest, text_hash: str, broadcast_text_id,
             race_gender: str, flavor: str | None) -> tuple:
    """The group of rows that must agree on one flavor, because they share one audio file.

    The file as tts_cli/naming.py derives it, paired with the race-gender. The player-gender
    prefix is irrelevant here: both variants of a line are the same NPC.

    Keyed on race-gender as well as the file because a quest given by a dwarf and a troll is
    one file with two voices already, and always has been. Agreeing a flavor across that pair
    does not make it one voice, it just hands the dwarf the troll's flavor - a
    dwarf-male-dark that no clips exist for.

    A follow-up line's file is named after its voice, flavor included, so its group is only
    ever NPCs that already agree: same words, same race-gender-flavor. Keyed on the quest or
    on the text hash instead, a dwarf-male-grim ender would be recorded in the standard
    voice of whoever else says the line - the one thing its naming exists to prevent.
    """
    if source == FOLLOWUP:
        # rsplit: a model slot's race has a dash of its own (model-29-male).
        return followup_stem(broadcast_text_id, voice_name(*race_gender.rsplit("-", 1), flavor)), \
            race_gender
    return (f"{quest}-{source}" if quest else text_hash), race_gender
