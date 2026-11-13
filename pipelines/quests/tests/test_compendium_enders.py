"""Who each quest is handed in to, as the Compendium's data gives it (export_compendium.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from export_compendium import quest_enders, quest_line  # noqa: E402


def test_a_quest_handed_in_to_another_than_its_giver_names_that_one():
    quests = {1: {"giver": "creature:10", "handIn": "creature:20"}}
    assert quest_enders([("creature", 20, 1)], quests) == {1: "creature:20"}


def test_a_quest_handed_back_to_its_giver_names_none():
    quests = {1: {"giver": "creature:10", "handIn": "creature:10"}}
    assert quest_enders([("creature", 10, 1)], quests) == {}


def test_the_db_wins_over_a_corpus_that_has_no_hand_in_line():
    quests = {1: {"giver": "creature:10"}}
    assert quest_enders([("creature", 30, 1)], quests) == {1: "creature:30"}


def test_of_several_the_corpus_speaker_wins_then_the_giver_then_the_lowest_creature():
    quests = {1: {"giver": "creature:10", "handIn": "creature:40"},
              2: {"giver": "creature:10"},
              3: {"giver": "creature:10"}}
    rows = [("creature", 30, 1), ("creature", 40, 1),
            ("creature", 30, 2), ("creature", 10, 2),
            ("gameobject", 5, 3), ("creature", 50, 3), ("creature", 45, 3)]
    assert quest_enders(rows, quests) == {1: "creature:40", 3: "creature:45"}


def test_a_quest_the_db_lacks_takes_the_corpus_speaker():
    quests = {1: {"giver": "creature:10", "handIn": "gameobject:7"}, 2: {"giver": "creature:10"}}
    assert quest_enders([], quests) == {1: "gameobject:7"}


def test_a_quest_with_no_offer_line_names_who_it_is_handed_in_to():
    quests = {1: {"handIn": "creature:20"}}
    assert quest_enders([("creature", 20, 1)], quests) == {1: "creature:20"}


def test_the_quest_line_writes_a_creature_as_ender_and_an_object_as_ender_object():
    assert quest_line(1, "First", zones=[1429], ender="creature:20") == \
        '\t\t[1] = { "First", zones = { 1429 }, ender = 20 },'
    assert quest_line(2, "Second", zones=[1429], ender="gameobject:7") == \
        '\t\t[2] = { "Second", zones = { 1429 }, enderObject = 7 },'
    assert "ender" not in quest_line(3, "Third", zones=[1429])
