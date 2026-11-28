"""A type for every creature in the world database that the npc table does not have yet.

Most vendors, guards and trainers say no quest or gossip line, so the corpus never named them,
yet each greets the player in its voice set. A pack that voices NPC barks needs their type to
play the right one. A creature drawn as two or more bodies is npc_body's business
(npc_bodies.py) and is left out here.
"""
from __future__ import annotations

from collections import defaultdict

from tts_cli.consts import GENDER_DICT, RACE_DICT
from tts_cli.flavors import busiest, flavor_from_sound_name
from tts_cli.npc_bodies import UNIT_SEX, body_name


def npc_types(display_rows, known: set, defaults: dict) -> list[dict]:
    """[{npcId, race, gender, sex, flavor}] for each creature not in `known` with one humanoid
    body. `display_rows` are query_creature_displays()'s (entry, slot, probability,
    DisplayRaceID, DisplaySexID, npc_sound_name); `defaults` is fallback_flavors' answer per
    race-gender, for a creature whose displays name no voice set."""
    displays = defaultdict(list)
    for entry, _slot, probability, race_id, sex_id, sound in display_rows:
        race = RACE_DICT.get(int(race_id))
        if race and race != "narrator" and int(sex_id) in UNIT_SEX:
            displays[int(entry)].append((race, int(sex_id), int(probability or 0), sound))

    found = []
    for npc_id in sorted(displays):
        rows = displays[npc_id]
        if npc_id in known or len({(race, sex_id) for race, sex_id, _, _ in rows}) != 1:
            continue
        race, sex_id = rows[0][0], rows[0][1]
        gender = GENDER_DICT[sex_id]
        tally = defaultdict(int)
        for _, _, weight, sound in rows:
            flavor = flavor_from_sound_name(sound, body_name(race, gender))
            if flavor:
                # vmangos leaves every probability 0 for a creature drawn at even odds.
                tally[flavor] += weight or 1
        found.append({"npcId": npc_id, "race": race, "gender": gender, "sex": UNIT_SEX[sex_id],
                      "flavor": busiest(tally) or defaults.get(body_name(race, gender))})
    return found
