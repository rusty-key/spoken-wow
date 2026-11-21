"""corpus/zones.json (export_zones.py): the quests' zones from the Compendium, the speakers' from their spawns."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from export_compendium import quest_line  # noqa: E402
from export_zones import build, render  # noqa: E402


class FakeMaps:
    """Places a spawn by its x alone: below 0 Durotar, else The Barrens."""

    uimaps = {1411: {"Name_lang": "Durotar"}, 1413: {"Name_lang": "The Barrens"}, 1429: {"Name_lang": "Elwynn Forest"}}

    def giver_zones(self, giver, spawns):
        zones = []
        for spawn in spawns.get(giver, []):
            zone = 1411 if spawn["x"] < 0 else 1413
            if zone not in zones:
                zones.append(zone)
        return zones


QUESTS = {
    7: quest_line(7, "Kobold Camp Cleanup", [1429]),
    81: quest_line(81, "A class quest", group=81),
}
SPAWNS = {
    "creature:3429": [{"map": 1, "x": 5, "y": 0}, {"map": 1, "x": 9, "y": 0}],
    "creature:3143": [{"map": 1, "x": -5, "y": 0}, {"map": 1, "x": 5, "y": 0}],
    "gameobject:1": [],
}


def test_a_quest_is_where_the_compendium_files_it_and_a_sorted_one_is_nowhere():
    assert build(QUESTS, SPAWNS, FakeMaps())["quests"] == {"7": [1429]}


def test_a_speaker_is_in_each_zone_a_spawn_stands_in_once():
    speakers = build(QUESTS, SPAWNS, FakeMaps())["speakers"]
    assert speakers == {"creature:3143": [1411, 1413], "creature:3429": [1413]}


def test_only_the_zones_in_use_are_offered_by_name():
    names = [zone["name"] for zone in build(QUESTS, SPAWNS, FakeMaps())["zones"]]
    assert names == ["Durotar", "Elwynn Forest", "The Barrens"]


def test_the_file_reads_back_as_what_was_built():
    data = build(QUESTS, SPAWNS, FakeMaps())
    assert json.loads(render(data)) == data
