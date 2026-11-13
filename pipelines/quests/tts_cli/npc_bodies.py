"""Which NPCs come in several bodies under one id, who each body is, and which body a sex is
heard as where only the sex is known.

A body is a race and a sex, as a display's CreatureDisplayInfoExtra row names them (migration
0075). A creature splits when its displays name two or more. Each body's flavor is the one its
displays name most, weighted by probability; a body whose displays name none gets none, and the
import gives it its race-gender's default, marked doubtful.
"""
from __future__ import annotations

from collections import defaultdict
from typing import NamedTuple

from tts_cli.consts import GENDER_DICT, RACE_DICT
from tts_cli.flavors import busiest, flavor_from_sound_name, voice_name

#: UnitSex's answer for each DisplaySexID: what the addon reports and npc_body is keyed on.
UNIT_SEX = {0: 2, 1: 3}
#: The gender each UnitSex is voiced in.
SEX_GENDER = {UNIT_SEX[sex_id]: gender for sex_id, gender in GENDER_DICT.items()}
#: The UnitSex a gender is drawn as.
GENDER_SEX = {gender: sex for sex, gender in SEX_GENDER.items()}


def body_name(race: str, gender: str) -> str:
    """A body as the packs and the addon key it: "gnome-female"."""
    return f"{race}-{gender}"


class Display(NamedTuple):
    slot: int
    weight: int
    race: str
    sex_id: int
    sound: str | None


def npc_bodies(display_rows, npcs) -> list:
    """The corpus's `npcBodies` for the creatures among `npcs` drawn as two or more bodies.

    `display_rows` are (entry, slot, probability, DisplayRaceID, DisplaySexID, npc_sound_name).
    Only a creature with a humanoid answer is split: a model slot or a generic type has no body.
    """
    displays = defaultdict(list)
    for entry, slot, probability, race_id, sex_id, sound in display_rows:
        race = RACE_DICT.get(int(race_id))
        if race and int(sex_id) in UNIT_SEX:
            displays[int(entry)].append(Display(int(slot), int(probability or 0), race,
                                                int(sex_id), sound))

    split = []
    for npc in sorted(npcs, key=lambda npc: npc["npcId"]):
        if npc["npcType"] != "creature" or npc.get("gender") not in ("male", "female"):
            continue
        rows = displays.get(npc["npcId"], [])
        if len({(row.race, row.sex_id) for row in rows}) < 2:
            continue
        # vmangos leaves every probability 0 for a creature drawn at even odds.
        if not any(row.weight for row in rows):
            rows = [row._replace(weight=1) for row in rows]
        bodies = defaultdict(list)
        for row in rows:
            bodies[(row.race, row.sex_id)].append(row)
        found = []
        for (race, sex_id), mine in bodies.items():
            gender = GENDER_DICT[sex_id]
            tally = defaultdict(int)
            for row in mine:
                flavor = flavor_from_sound_name(row.sound, body_name(race, gender))
                if flavor:
                    tally[flavor] += row.weight
            flavor = busiest(tally)
            found.append(({"npcType": "creature", "npcId": npc["npcId"], "race": race,
                           "sex": UNIT_SEX[sex_id], "gender": gender,
                           "weight": sum(row.weight for row in mine), "flavor": flavor,
                           "provenance": "corpus", "voice": voice_name(race, gender, flavor)},
                          min(row.slot for row in mine)))
        found.sort(key=lambda pair: (pair[0]["sex"], -pair[0]["weight"], pair[1]))
        split.extend(row for row, _ in found)
    return split


def sex_bodies(bodies, npc_race) -> dict:
    """{sex: the body heard where only that sex is known}, for one split NPC's `bodies` in export
    order: the sex's body of the NPC's own race, else its heaviest, else its first. The packs'
    per-sex tables are built from these, for addons that cannot read a body."""
    chosen = {}
    for sex in sorted({row["sex"] for row in bodies}):
        mine = [row for row in bodies if row["sex"] == sex]
        own = [row for row in mine if row["race"] == npc_race]
        chosen[sex] = own[0] if own else max(mine, key=lambda row: row.get("weight") or 0)
    return chosen
