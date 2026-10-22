"""Which creature gets a face on the Quests tab (export_quest_faces.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from export_quest_faces import drawable, faces, live_models, speakers  # noqa: E402


def test_a_display_the_client_has_with_its_model_is_drawable():
    displays = [{"ID": "100", "ModelID": "7"}, {"ID": "101", "ModelID": "8"}]
    assert drawable(displays, [{"ID": "7"}]) == {100}


def test_a_creature_with_one_model_the_client_has_gets_it():
    assert faces({1: {100}}, {100}) == {1: 100}


def test_a_creature_whose_model_the_client_lacks_gets_none():
    assert faces({1: {46093}}, {100}) == {}


def test_a_creature_with_several_models_gets_none_even_when_the_client_lacks_all_but_one():
    assert faces({1: {100, 46093}}, {100}) == {}


def test_every_creature_that_says_a_quest_line_is_a_speaker_not_only_the_first():
    lines = [{"questId": 1, "source": "accept", "npcType": "creature", "npcId": 10},
             {"questId": 1, "source": "accept", "npcType": "creature", "npcId": 11},
             {"questId": 1, "source": "complete", "npcType": "creature", "npcId": 12},
             {"questId": 1, "source": "gossip", "npcType": "creature", "npcId": 13},
             {"questId": 1, "source": "accept", "npcType": "gameobject", "npcId": 14},
             {"questId": 2, "source": "accept", "npcType": "creature", "npcId": 15}]
    assert speakers(lines, dropped={2}) == {10, 11, 12}


def test_the_live_model_is_the_latest_build_that_saw_the_creature():
    sets = {"1.60.1.70124": {"creatures": {"5": {"displays": [{"displayId": 100}]}}},
            "1.60.1.70338": {"creatures": {"5": {"displays": [{"displayId": 101}]},
                                           "6": {"displays": []}}}}
    assert live_models(sets) == {5: {101}}
