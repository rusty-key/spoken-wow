"""Forever's client data in the Compendium's export (export_compendium.py): Efficient Games'
quests.enUS.json and npcs.json, read after the DB, adding to it, its zone and race limit winning
over the DB's."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

import export_compendium  # noqa: E402
from export_compendium import (chain_links, eg_datasets, eg_races, forever_quests, gates, place,  # noqa: E402
                               quest_line, served_quests, without_text)


class FakeMaps:
    """Areas 12 (Elwynn Forest) and 15912 (Zephras Isle) have zones; 16611 (Ruins of Lordaeron) has
    none. uiMap 1455 is Ironforge, 1458 Undercity, 2257 a district inside Ironforge."""
    AREAS = {12: 1429, 15912: 2521, 36: 1416}
    UIMAPS = {1455: 1455, 1458: 1458, 2257: 1455}
    # 2597 is Alterac Valley's own area, 2839 an area of Alterac Mountains named after it.
    BATTLEGROUNDS = {2597: 1459, 2839: 1459}

    def zone_of_area(self, area):
        return self.AREAS.get(area)

    def battleground_of_area(self, area):
        return self.BATTLEGROUNDS.get(area)

    def zone_of_uimap(self, uimap):
        return self.UIMAPS.get(uimap)


SORTS = {141: {"enUS": "Paladin"}, 284: {"enUS": "Special"}}


def _place(sort=0, eg=None, seen=(), givers=()):
    zones, group, source = place(sort, FakeMaps(), SORTS, eg, seen, lambda: list(givers))
    return zones, group, source


def test_the_clients_zone_wins_over_the_dbs_other_zone():
    # 545 Dalaran Patrols: the DB files it in Hillsbrad Foothills, Forever's quest log in Alterac
    # Mountains.
    assert _place(12, {"zoneAreaId": 15912}) == ([2521], None, "client")
    assert _place(12, {"zoneAreaId": 12}) == ([1429], None, "db")


def test_the_dbs_sort_or_battleground_stands_whatever_the_clients_zone():
    assert _place(-141, {"zoneAreaId": 15912}) == ([], 141, "db")
    assert _place(2839, {"zoneAreaId": 36}) == ([1459], None, "db")
    assert _place(36, {"zoneAreaId": 2839}) == ([1416], None, "db")
    assert _place(12, {"zoneAreaId": 16611}) == ([1429], None, "db")


def test_a_quest_the_db_does_not_place_takes_the_clients_zone_or_sort():
    assert _place(0, {"zoneAreaId": 15912}, givers=[1436]) == ([2521], None, "client")
    assert _place(0, {"categoryId": 141}, givers=[1436]) == ([], 141, "client")


def test_a_forever_area_with_no_map_is_placed_where_its_giver_was_seen():
    assert _place(0, {"zoneAreaId": 16611}, seen=[1458], givers=[1420]) == ([1458], None, "client")
    assert _place(0, {"zoneAreaId": 16611}, seen=[2257]) == ([1455], None, "client")


def test_where_the_giver_stands_comes_before_where_players_saw_it():
    assert _place(0, None, seen=[1458], givers=[1420]) == ([1420], None, "giver")
    assert _place(0, None, seen=[1458]) == ([1458], None, "client")
    assert _place(0, None) == ([], None, None)


def test_a_race_mask_of_the_client_is_its_playable_bits():
    assert eg_races({"raceMask": "0000000300000000"}) == 3 << 32
    assert eg_races({}) == 0


def test_the_latest_build_has_the_last_word_and_an_offer_beats_a_hand_in():
    quests, seen = forever_quests(
        {"1.60.1.70009": {"quests": {"5": {"title": "Old"}, "6": {"title": "Six"}}},
         "1.60.1.70338": {"quests": {"5": {"title": "New"}}}},
        {"1.60.1.70338": {
            "npcs": {"1": {"offers": {"5": {}}, "positions": [{"uiMap": 1458}]},
                     "2": {"takes": {"5": {}, "6": {}}, "positions": [{"uiMap": 1455}]}},
            "objects": {"3": {"offers": {"7": {}}, "positions": [{"uiMap": 1429}, {"uiMap": 0}]}}}})
    assert quests[5]["title"] == "New" and quests[6]["title"] == "Six"
    assert seen == {5: [1458], 6: [1455], 7: [1429]}


def _row(prev=0, nxt=0, breadcrumb=0):
    return {"prev": prev, "next": nxt, "group": 0, "breadcrumb": breadcrumb}


def test_the_clients_next_quest_links_only_where_the_db_has_no_link():
    rows = {1: _row(nxt=2), 2: _row(), 3: _row(), 4: _row()}
    # The client says 3 opens 2 (the DB says 1 does) and 3 opens 4 (the DB says nothing).
    assert chain_links(rows, {1, 2, 3, 4}, {3: 4, 30: 2}) == {2: 1, 4: 3}
    # Forever's own quests, which the DB lacks altogether.
    assert chain_links({}, {92001, 92002}, {92001: 92002}) == {92002: 92001}


def test_the_clients_next_quest_links_where_the_dbs_link_leads_to_no_quest_of_the_corpus():
    # 1473 Creature of the Void: the DB's only link into it is a breadcrumb the corpus lacks (9),
    # the client's is 1478 Halgar's Summons.
    rows = {9: _row(breadcrumb=1473), 1473: _row(), 1478: _row()}
    assert chain_links(rows, {1473, 1478}, {1478: 1473}) == {1473: 1478}
    assert chain_links(rows, {1473, 1478}) == {}


def test_the_clients_next_quest_opens_a_quest_the_db_opens_nothing_into():
    assert gates({1: _row(nxt=2)}, {3: 2, 5: 6}) == {2: {1}, 6: {5}}


@pytest.fixture
def remote(tmp_path, monkeypatch):
    """Efficient Games' repository: files by path under data/, and the paths fetched."""
    files, fetched = {}, []

    def fetch(url, path):
        rel = url[len(export_compendium.EG_DATA) + 1:]
        fetched.append(rel)
        if rel not in files:
            raise OSError("offline")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(files[rel]), encoding="utf-8")

    monkeypatch.setattr(export_compendium, "EG_CACHE", str(tmp_path / "efficient-games"))
    monkeypatch.setattr(export_compendium, "fetch", fetch)
    return files, fetched


def _index(entries):
    return {"products": {"wow_classic_beta": {b: {"quests.enUS": e} for b, e in entries.items()}}}


def test_the_data_is_read_at_one_commit_and_fetched_once(remote):
    files, fetched = remote
    files["index.json"] = _index({"1.60.1.70338": {"lastCollectedOn": "2026-10-12", "records": 1},
                                  "1.60.1.70009": {"lastCollectedOn": "2026-09-30", "records": 1}})
    files["wow_classic_beta/1.60.1.70338/quests.enUS.json"] = {"quests": {"1": {"title": "a"}}}
    files["wow_classic_beta/1.60.1.70009/quests.enUS.json"] = {"quests": {"1": {"title": "old"}}}

    assert export_compendium.EG_COMMIT in export_compendium.EG_DATA
    assert list(eg_datasets("quests.enUS")) == ["1.60.1.70009", "1.60.1.70338"]
    # The repository moving on changes nothing: the pinned commit's files are the cached ones.
    files["index.json"] = _index({"1.60.1.70338": {"lastCollectedOn": "2026-10-13", "records": 2}})
    files["wow_classic_beta/1.60.1.70338/quests.enUS.json"] = {"quests": {"1": {"title": "b"}}}
    fetched.clear()
    assert eg_datasets("quests.enUS")["1.60.1.70338"]["quests"]["1"]["title"] == "a"
    assert fetched == []


def test_offline_the_cache_is_read(remote):
    files, fetched = remote
    files["index.json"] = _index({"1.60.1.70338": {"lastCollectedOn": "2026-10-12", "records": 1}})
    files["wow_classic_beta/1.60.1.70338/quests.enUS.json"] = {"quests": {"1": {"title": "a"}}}
    eg_datasets("quests.enUS")
    files.clear()
    assert eg_datasets("quests.enUS")["1.60.1.70338"]["quests"]["1"]["title"] == "a"


def test_offline_with_nothing_cached_the_export_stops(remote):
    with pytest.raises(OSError):
        eg_datasets("quests.enUS")


def test_a_giver_found_in_four_zones_or_more_places_its_quest_nowhere():
    assert _place(0, None, givers=[1453, 1455, 1457, 1417]) == ([], None, None)
    assert _place(0, None, givers=[1453, 1455, 1457]) == ([1453, 1455, 1457], None, "giver")


def test_a_quest_filed_under_an_area_named_after_a_battleground_is_that_battlegrounds():
    assert _place(2839, None, givers=[1455]) == ([1459], None, "db")
    assert _place(0, {"zoneAreaId": 2597}, givers=[1455]) == ([1459], None, "client")


def _rec(zones=(), prev=None):
    return {"title": "", "zones": list(zones), "sort": None, "prev": prev}


def test_a_battlemasters_next_quest_is_filed_under_the_battleground_of_the_one_before():
    records = {8399: _rec([1460]), 8404: _rec([], prev=8399), 8405: _rec([1455], prev=8404),
               7000: _rec([1455], prev=8399)}
    givers = {8399: "creature:15351", 8404: "creature:15351", 8405: "creature:15351", 7000: "creature:1"}
    export_compendium.battleground_follow_ups(records, givers)
    assert records[8404]["zones"] == [1460] and records[8405]["zones"] == [1460]
    assert records[7000]["zones"] == [1455]


def test_the_file_says_which_builds_and_data_it_was_made_from():
    lua = export_compendium.render({}, {})
    assert f"Forever {export_compendium.BUILD} and Era {export_compendium.ERA_BUILD}" in lua
    assert f"commit {export_compendium.EG_COMMIT[:7]}" in lua


def test_a_quest_is_served_where_players_saw_it_offered_handed_in_or_worked_on():
    npcs = {"1.60.1.70338": {"npcs": {"10": {"offers": {"5": {}}, "takes": {"6": {}}}},
                             "objects": {"20": {"offers": {"7": {}}}}}}
    objectives = {"1.60.1.70338": {"quests": {"8": {}}, "completed": {"9": {}}, "failed": {"11": {}}}}
    assert served_quests(npcs, objectives) == {5, 6, 7, 8, 9}


def test_a_served_quest_the_corpus_lacks_is_listed_without_words():
    client = {96259: {"title": "Defending the Dead", "zoneAreaId": 12, "raceMask": "00000002000000B2",
                      "nextQuestId": 96261},
              96261: {"title": "The Broodmother", "zoneAreaId": 12},
              5: {"title": "Jitters' Growling Gut"}, 236: {"title": "Awaiting Word"}, 99999: {}}
    records = without_text({5: {}}, {5, 236, 96259, 96261, 99999}, client, {}, FakeMaps(), {}, removed={236})
    assert set(records) == {96259, 96261}
    assert records[96259] == {"title": "Defending the Dead", "zones": [1429], "sort": None, "dungeon": None,
                              "races": 0x2000000B2, "classes": 0, "prev": None, "notext": True}
    assert records[96261]["prev"] == 96259
    assert quest_line(96261, "The Broodmother", [1412], prev=96259, notext=True) == \
        '\t\t[96261] = { "The Broodmother", zones = { 1412 }, prev = 96259, notext = true },'


class DungeonMaps(FakeMaps):
    """Area 16544 is in the City of Dalaran (map 2959), whose entrance is in Alterac Mountains."""

    def dungeon_of_area(self, area, dungeons):
        return 2959 if area == 16544 and 2959 in dungeons else None


def test_a_served_quest_of_a_dungeon_is_filed_under_it_as_the_corpuss_are():
    # 96987 Opportunistic Education, beside 96986 and 96988 in the City of Dalaran.
    client = {96987: {"title": "Opportunistic Education", "zoneAreaId": 16544}}
    records = without_text({}, {96987}, client, {}, DungeonMaps(), {}, dungeons={2959: {}})
    assert records[96987]["dungeon"] == 2959
    assert records[96987]["zones"] == [export_compendium.INSTANCE_ZONE[2959]]
