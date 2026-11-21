"""One side's quests, as the Compendium's data gives them (export_compendium.py quest_races): the
DB's mask, else corpus/factions.json's side, else the side of the quests that open it, else the
side of the NPCs that start or end it."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from export_compendium import SIDE_RACES, db_races, gates, giver_sides, npc_side, quest_races, side_leaks  # noqa: E402

ALLIANCE, HORDE = SIDE_RACES["alliance"], SIDE_RACES["horde"]
EVERYONE = (1 << 64) - 1


def _row(prev=0, nxt=0, group=0, breadcrumb=0):
    return {"prev": prev, "next": nxt, "group": group, "breadcrumb": breadcrumb}


def test_the_dbs_own_limit_stands():
    assert quest_races({1: 8}, {"1": "horde"}, {}) == {1: 8}


def test_a_quest_the_db_opens_to_everyone_takes_its_givers_side():
    # 59 of Elwynn's 64 quests: AllowableRaces 0 or all, an Alliance giver.
    assert quest_races({1: 0, 2: EVERYONE, 3: db_races(0xFFFFFFFF)}, {"1": "alliance", "2": "horde", "3": "horde"}, {}) \
        == {1: ALLIANCE, 2: HORDE, 3: HORDE}


def test_a_quest_with_no_side_anywhere_is_anyones():
    assert quest_races({1: 0}, {}, {}) == {1: 0}


def test_a_follow_up_open_to_everyone_takes_the_side_of_the_quest_opening_it():
    # A chain started by a Horde giver, whose follow-ups have a neutral giver and no mask.
    rows = {1: _row(), 2: _row(prev=1), 3: _row(prev=2)}
    races = quest_races({1: 0, 2: 0, 3: EVERYONE}, {"1": "horde"}, gates(rows))
    assert races == {1: HORDE, 2: HORDE, 3: HORDE}
    assert side_leaks(races, {2: 1, 3: 2}) == []


def test_a_follow_up_of_one_race_takes_that_races_side():
    assert quest_races({1: 8, 2: 0}, {}, gates({2: _row(prev=1)})) == {1: 8, 2: ALLIANCE}


def test_a_quest_both_sides_quests_open_stays_open_to_both():
    # The Stone Watcher, after either side's Seeing What Happens (NextQuestID on both).
    rows = {2946: _row(nxt=2954), 2966: _row(nxt=2954), 2954: _row()}
    races = quest_races({2946: 0, 2966: 0, 2954: 0}, {"2946": "alliance", "2966": "horde"}, gates(rows))
    assert races[2954] == 0


def test_a_breadcrumb_gives_its_quest_no_side():
    rows = {1: _row(breadcrumb=2), 2: _row()}
    assert quest_races({1: 0, 2: 0}, {"1": "alliance"}, gates(rows)) == {1: ALLIANCE, 2: 0}


def test_a_quest_the_corpus_lacks_is_passed_through():
    rows = {1: _row(), 2: _row(prev=1), 3: _row(prev=2)}
    assert quest_races({1: 0, 3: 0}, {"1": "alliance"}, gates(rows)) == {1: ALLIANCE, 3: ALLIANCE}


def test_a_follow_up_with_its_own_side_keeps_it_and_is_a_leak():
    # The DB itself saying the other side: kept, and counted for a person to look at.
    races = quest_races({1: 0, 2: 0}, {"1": "alliance", "2": "horde"}, gates({2: _row(prev=1)}))
    assert races == {1: ALLIANCE, 2: HORDE}
    assert side_leaks(races, {2: 1}) == [(2, 1)]


def test_an_npc_hostile_to_one_side_only_is_the_others():
    assert npc_side(4) == "alliance"           # Stormwind (FactionTemplate 12)
    assert npc_side(4 | 8) == "alliance"       # Stormwind's guards (11)
    assert npc_side(2 | 8) == "horde"          # Orgrimmar's guards (85)
    assert npc_side(0) is None                 # Southshore's magistrate (96), Ruul Snowhoof (714)
    assert npc_side(8) is None                 # hostile to monsters only
    assert npc_side(2 | 4) is None


def test_a_quest_takes_its_starters_side_else_with_no_starter_its_enders():
    sides = {"creature:1": "alliance", "creature:2": "horde", "gameobject:3": None, "creature:4": "alliance"}
    found = giver_sides(
        {91743: {"creature:1"}, 2: {"creature:1", "creature:2"}, 3: {"gameobject:3"}, 4: {"creature:1", "creature:4"}},
        {91743: {"creature:2"}, 3: {"creature:1"}, 7781: {"creature:4"}},
        sides.get)
    # 7781 The Lord of Blackrock, started by an item, is handed in in Stormwind. A starter of no
    # side (3) or of both (2) leaves the quest to both.
    assert found == {91743: "alliance", 4: "alliance", 7781: "alliance"}


def test_the_starters_side_comes_last_and_a_follow_up_takes_it():
    # 91741 Nibbled-On Book, handed in to an Alliance NPC; 91743 after it, with no NPC of a side.
    rows = {91743: _row(prev=91741)}
    races = quest_races({91741: 0, 91743: 0, 3: 0, 4: 8}, {"3": "horde"}, gates(rows),
                        {91741: "alliance", 3: "alliance", 4: "horde"})
    assert races == {91741: ALLIANCE, 91743: ALLIANCE, 3: HORDE, 4: 8}


def test_a_quest_after_one_anyone_may_take_stays_open():
    races = quest_races({1: 0, 2: 0}, {}, gates({2: _row(prev=1)}))
    assert races == {1: 0, 2: 0}
    assert side_leaks(races, {2: 1}) == []
