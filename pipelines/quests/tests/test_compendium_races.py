"""Who may take each quest, as the Compendium's data gives it (export_compendium.py): the race
mask's playable bits, Skyborne's 32 and 33 included."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from export_compendium import db_races, playable_races, quest_classes, quest_line, race_mask  # noqa: E402

HIGH_ORDER, WINDSHAPER = 1 << 32, 1 << 33
ALLIANCE, HORDE = 1 | 4 | 8 | 64, 2 | 16 | 32 | 128
# The DB's retail faction masks, as quest_template.AllowableRaces has them.
RETAIL_ALLIANCE, RETAIL_HORDE = 0x55155555B1354C4D, 0xAA2AAAAA4E0AB3B2
EVERYONE = (1 << 64) - 1


def test_skyborne_bits_are_kept():
    # 92474 Falling With Style and 92598 The Gift of Skysight, as the DB has them.
    assert db_races(HIGH_ORDER | WINDSHAPER) == HIGH_ORDER | WINDSHAPER
    assert db_races(WINDSHAPER) == WINDSHAPER
    assert quest_line(92598, "The Gift of Skysight", races=WINDSHAPER).endswith("races = 8589934592 },")


def test_a_retail_faction_mask_is_that_sides_races_skyborne_included():
    assert db_races(RETAIL_ALLIANCE) == ALLIANCE | HIGH_ORDER
    assert db_races(RETAIL_HORDE) == HORDE | WINDSHAPER


def test_a_classic_side_mask_in_the_db_takes_that_sides_skyborne_too():
    assert db_races(ALLIANCE) == ALLIANCE | HIGH_ORDER
    assert db_races(HORDE) == HORDE | WINDSHAPER


def test_one_race_stays_that_race():
    assert db_races(8) == 8
    assert db_races(8 | HIGH_ORDER) == 8 | HIGH_ORDER


def test_every_classic_race_in_the_db_or_none_is_anyone():
    # Forever's client has the DB's 0xFF and 0xFFFFFFFF as everyone; a mask naming only races
    # nobody plays here (Blood Elf, 512) is no limit the tab could keep.
    for mask in (0, 0xFF, 0xFFFFFFFF, EVERYONE, ALLIANCE | HORDE | HIGH_ORDER | WINDSHAPER, 512):
        assert db_races(mask) == 0


def test_a_mask_as_the_client_has_it_is_kept_as_it_is():
    # 1522 Call of Fire: the Horde's Classic races, not the Windshapers, who have their own.
    assert playable_races(HORDE) == HORDE
    assert playable_races(0xFF) == 0xFF
    for mask in (0, EVERYONE, ALLIANCE | HORDE | HIGH_ORDER | WINDSHAPER, 512):
        assert playable_races(mask) == 0
        assert "races" not in quest_line(1, "Anyone", races=mask)


def test_forever_clients_own_limit_wins_over_the_dbs():
    # 26 A Lesson to Learn: the DB's Night Elf, the client's Night Elf and High Order Skyborne.
    assert race_mask(8, {"raceMask": "0000000100000008"}) == 8 | HIGH_ORDER
    # 5634 Desperate Prayer: the DB's Human and Dwarf, the client's Dwarf only.
    assert race_mask(5, {"raceMask": "0000000000000004"}) == 4
    # A quest the DB opens to everyone takes the client's limit, as before.
    assert race_mask(0, {"raceMask": "000000000000004d"}) == ALLIANCE


def test_a_client_mask_of_anyone_or_none_leaves_the_dbs():
    # 1470 Piercing the Veil: the DB's Orc and Undead, the client's anyone.
    assert race_mask(18, {"raceMask": "ffffffffffffffff"}) == 18
    assert race_mask(18, {}) == 18
    assert race_mask(18, None) == 18


def test_a_quest_filed_under_a_class_with_no_class_named_is_that_classs():
    # 65601 Love Hurts, Forever's warlock quest the DB lacks; 8249 Junkboxes Needed, a rogue's.
    assert quest_classes(0, 61) == 1 << 8
    assert quest_classes(0, 162) == 1 << 3
    assert quest_line(65601, "Love Hurts", group=61, classes=quest_classes(0, 61)).endswith("classes = 256 },")


def test_the_dbs_classes_stand_and_other_sorts_name_no_class():
    assert quest_classes(1 << 7, 61) == 1 << 7
    assert quest_classes(0, 666) == 0
    assert quest_classes(0, None) == 0
