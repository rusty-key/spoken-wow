import json

import pytest

from tts_cli.factions import (PACK_LABELS, PACK_SUFFIXES, PACKS, compendium_sides, load_sides,
                              pack_of_line, pack_stems, pack_title)

CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "source": "accept", "questId": 5, "fileName": "5-accept"},
        {"lineId": "q:7:accept", "source": "accept", "questId": 7, "fileName": "7-accept"},
        {"lineId": "q:9:accept", "source": "accept", "questId": 9, "fileName": "9-accept"},
        {"lineId": "g:abc123", "source": "gossip", "questId": None, "fileName": "abc123"},
    ],
}
SIDES = {5: "alliance", 7: "horde"}


def forms(*stems):
    """Each stem with its player-gender forms, which a pack carries with it."""
    return {f"{stem.split('/')[0]}/{prefix}{stem.split('/')[1]}"
            for stem in stems for prefix in ("", "m-", "f-")}


def test_a_quest_with_a_side_lands_in_that_pack():
    assert pack_of_line(CORPUS["lines"][0], SIDES) == "alliance"
    assert pack_of_line(CORPUS["lines"][1], SIDES) == "horde"


def test_a_quest_with_no_side_is_shared():
    # Absent means both sides can take it, which is the common case and why the export lists
    # only the exceptions.
    assert pack_of_line(CORPUS["lines"][2], SIDES) == "shared"


def test_gossip_is_its_own_pack_whatever_the_speaker():
    assert pack_of_line(CORPUS["lines"][3], SIDES) == "gossip"


def test_followup_lines_split_by_the_quest_that_says_them():
    # Words said after an Alliance quest and a Horde one are one file, a row under each quest;
    # seen on both sides, it ships in Shared rather than in one side's pack.
    corpus = {"lines": [
        {"lineId": "f:10:dwarf-male-standard", "source": "followup", "questId": 5,
         "fileName": "10-dwarf-male-standard"},
        {"lineId": "f:11:orc-male-standard", "source": "followup", "questId": 7,
         "fileName": "11-orc-male-standard"},
        {"lineId": "f:12:human-male-standard", "source": "followup", "questId": 5,
         "fileName": "12-human-male-standard"},
        {"lineId": "f:12:human-male-standard", "source": "followup", "questId": 7,
         "fileName": "12-human-male-standard"},
    ]}
    assert pack_of_line(corpus["lines"][0], SIDES) == "alliance"
    assert pack_stems(corpus, SIDES, "alliance") == forms("followup/10-dwarf-male-standard")
    assert pack_stems(corpus, SIDES, "horde") == forms("followup/11-orc-male-standard")
    assert pack_stems(corpus, SIDES, "shared") == forms("followup/12-human-male-standard")
    assert pack_stems(corpus, SIDES, "gossip") == set()


def test_stems_are_extension_free_so_they_match_a_transcoded_store():
    assert pack_stems(CORPUS, SIDES, "alliance") == forms("quests/5-accept")
    assert pack_stems(CORPUS, SIDES, "gossip") == forms("gossip/abc123")


def test_a_gossip_file_s_aliases_ship_beside_it():
    # The addon plays an alias when the file itself has no take, so the alias must be there.
    aliases = {"abc123": ["b6029-orc-male"]}
    assert pack_stems(CORPUS, SIDES, "gossip", aliases) == forms("gossip/abc123", "gossip/b6029-orc-male")
    assert pack_stems(CORPUS, SIDES, "alliance", aliases) == forms("quests/5-accept")


def test_a_line_s_player_gender_forms_ship_together():
    # A language's text can split by player gender where English's does not, and the other way
    # round, so its store holds forms the corpus does not name. The addon plays them all.
    assert pack_stems(CORPUS, SIDES, "alliance") >= {"quests/m-5-accept", "quests/f-5-accept"}
    gendered = {"lines": [
        {"lineId": "q:5:accept:m", "source": "accept", "questId": 5, "fileName": "m-5-accept"},
        {"lineId": "q:5:accept:f", "source": "accept", "questId": 5, "fileName": "f-5-accept"},
    ]}
    assert pack_stems(gendered, SIDES, "alliance") == forms("quests/5-accept")


def test_the_all_pack_is_every_stem():
    assert pack_stems(CORPUS, SIDES, "all") == forms(
        "quests/5-accept", "quests/7-accept", "quests/9-accept", "gossip/abc123")


def test_the_packs_partition_the_corpus():
    # Nothing may fall between the four: a line in no pack is a line that ships nowhere.
    split = set()
    for pack in ("alliance", "horde", "shared", "gossip"):
        stems = pack_stems(CORPUS, SIDES, pack)
        assert not (split & stems), "a stem appears in two packs"
        split |= stems
    assert split == pack_stems(CORPUS, SIDES, "all")


def test_an_unknown_pack_is_refused():
    with pytest.raises(ValueError):
        pack_stems(CORPUS, SIDES, "neutral")


def test_sides_load_with_integer_quest_ids(tmp_path):
    path = tmp_path / "factions.json"
    path.write_text(json.dumps({"sides": {"5": "alliance", "7": "horde"}}))

    assert load_sides(str(path), str(tmp_path / "none.lua")) == {5: "alliance", 7: "horde"}


def test_a_missing_export_sides_with_nobody(tmp_path):
    """A checkout with no export builds one pack of everything rather than failing: the
    split is a packaging decision, and `build` still has to work without it."""
    assert load_sides(str(tmp_path / "nope.json"), str(tmp_path / "none.lua")) == {}


COMPENDIUM = """SpokenQuestsCompendium = {
\tversion = 1,

\tquests = {
\t\t[5] = { "Jitters' Growling Gut", zones = { 1431 }, ender = 272, races = 4294967373 },
\t\t[8] = { "A Rogue's Deal", zones = { 1420 }, races = 8589934770 },
\t\t[9] = { "The Killing Fields", zones = { 1436 } },
\t\t[92474] = { "Falling With Style", zones = { 2521 }, races = 4294967296 },
\t\t[92485] = { "A Student of Nature", sort = 263, races = 4294967297, classes = 1024 },
\t},

\tsorts = {
\t\t[263] = { "Druid" },
\t},
}
"""


def test_the_compendium_s_race_masks_give_a_quest_its_side(tmp_path):
    """Forever's quests are not in the vmangos DB the export reads, so the Compendium's race
    masks side them: a Skyborne-only quest is its side's, and one open to both sides is shared."""
    compendium = tmp_path / "Compendium.lua"
    compendium.write_text(COMPENDIUM, encoding="utf-8")
    assert compendium_sides(str(compendium)) == {5: "alliance", 8: "horde", 9: None, 92474: "alliance",
                                                 92485: "alliance"}


def test_the_compendium_wins_and_the_export_fills_in_what_it_does_not_list(tmp_path):
    compendium, export = tmp_path / "Compendium.lua", tmp_path / "factions.json"
    compendium.write_text(COMPENDIUM, encoding="utf-8")
    export.write_text(json.dumps({"sides": {"9": "alliance", "236": "horde"}}))
    assert load_sides(str(export), str(compendium)) == {5: "alliance", 8: "horde", 92474: "alliance",
                                                        92485: "alliance", 236: "horde"}


def test_pack_names_are_stable():
    assert PACKS == ("all", "alliance", "horde", "shared", "gossip")


def test_every_pack_has_a_folder_suffix_and_a_label():
    # A pack with no suffix would build over another pack's folder, and one with no label
    # would be indistinguishable in the AddOns list.
    assert set(PACK_SUFFIXES) == set(PACKS)
    assert set(PACK_LABELS) == set(PACKS)
    assert len(set(PACK_SUFFIXES.values())) == len(PACKS)
    assert len(set(PACK_LABELS.values())) == len(PACKS)


def test_a_title_reads_as_the_project_it_ships_to():
    assert pack_title("alliance") == "Spoken Audio: Quests - Alliance"
    assert pack_title("shared") == "Spoken Audio: Quests - Shared"


def test_a_family_names_a_whole_set_of_packs_at_once():
    # A set of packs built together is named together, and its CurseForge projects are named
    # for the family rather than per pack - so the family is a parameter and not five more
    # constants to keep in step. One family ships today; a language pack would be the next.
    assert pack_title("horde", "Spoken German Audio") == "Spoken German Audio: Quests - Horde"
