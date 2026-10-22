"""Which client tables place the Compendium's quests (export_compendium.py): Forever's, then Era's."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

import export_compendium  # noqa: E402
from export_compendium import BUILD, ERA_BUILD, Maps, area_reader, cell_of, read_tile, sort_names  # noqa: E402


def _uimap(*ids):
    return [{"ID": str(i), "Type": "3"} for i in ids]


def _assign(uimap, area, mapid=0, region=(0, 0, 0, 0, 0, 0)):
    return {"UiMapID": str(uimap), "AreaID": str(area), "MapID": str(mapid),
            **{f"Region_{n}": str(v) for n, v in enumerate(region)}}


def _area(area, parent=0, continent=0, name=""):
    return {"ID": str(area), "ParentAreaID": str(parent), "ContinentID": str(continent), "AreaName_lang": name}


# Forever's tables add Zephras Isle (2521, area 15912); Era's know Elwynn Forest only. An area only
# Era's place (here 9999) stands for anything Forever's might leave out.
TABLES = {
    ("UiMap", BUILD): _uimap(1429, 2521),
    ("UiMapAssignment", BUILD): [_assign(1429, 12, 0, (-100, -100, 0, 100, 100, 0)), _assign(2521, 15912)],
    ("AreaTable", BUILD): [_area(12), _area(15912), _area(15913, parent=15912), _area(16732, continent=2998),
                           _area(16919, continent=3065), _area(2597, continent=30, name="Alterac Valley"),
                           _area(2839, parent=36, name="Alterac Valley"), _area(36, name="Alterac Mountains")],
    ("UiMap", ERA_BUILD): _uimap(1429, 1437),
    ("UiMapAssignment", ERA_BUILD): [_assign(1429, 12), _assign(1437, 9999, 0, (200, 200, 0, 300, 300, 0))],
    ("AreaTable", ERA_BUILD): [_area(12), _area(9999)],
}


def _maps(monkeypatch):
    monkeypatch.setattr(export_compendium, "table", lambda name, locale="enUS", build=BUILD: TABLES[(name, build)])
    return Maps()


def test_a_zone_only_forever_has_places_its_quests(monkeypatch):
    maps = _maps(monkeypatch)
    assert maps.zone_of_area(15912) == 2521
    assert maps.zone_of_area(15913) == 2521


def test_eras_tables_place_what_forevers_do_not(monkeypatch):
    maps = _maps(monkeypatch)
    assert maps.zone_of_area(9999) == 1437
    assert maps.zone_at(0, 250, 250) == 1437
    assert maps.zone_at(0, 50, 50) == 1429


def test_a_sorts_name_is_forevers_and_eras_fills_what_it_lacks():
    forever = [{"ID": "666", "SortName_lang": "Camping"}, {"ID": "61", "SortName_lang": ""}]
    era = [{"ID": "61", "SortName_lang": "Warlock"}, {"ID": "666", "SortName_lang": "old"}]
    assert sort_names({"enUS": [forever, era]}) == {666: {"enUS": "Camping"}, 61: {"enUS": "Warlock"}}


def test_forevers_instanced_places_are_filed_under_the_zone_around_them(monkeypatch):
    # Excavation Site: Wetlands and The Hall of Thanes, areas of instance maps with no map of
    # their own.
    maps = _maps(monkeypatch)
    assert maps.zone_of_area(16732) == 1437
    assert maps.zone_of_area(16919) == 1455


def test_an_area_named_after_a_battleground_is_that_battleground(monkeypatch):
    maps = _maps(monkeypatch)
    assert maps.battleground_of_area(2597) == 1459
    assert maps.battleground_of_area(2839) == 1459
    assert maps.battleground_of_area(36) is None


# Blackrock Depths (map 230) has its own area 1584, on the Eastern Kingdoms' map; Gnomeregan (90)
# names its own area 721, and the quest log files its quests under 133, a Dun Morogh area of its
# name; Shadowfang Keep's quests are under an area of its map, 209.
DUNGEON_MAPS = {230: {"MapName_lang": "Blackrock Depths", "AreaTableID": "1584"},
                90: {"MapName_lang": "Gnomeregan", "AreaTableID": "721"},
                33: {"MapName_lang": "Shadowfang Keep", "AreaTableID": "0"}}


def test_a_dungeons_quest_is_known_by_its_area_its_map_or_its_name(monkeypatch):
    monkeypatch.setitem(TABLES, ("AreaTable", BUILD), TABLES[("AreaTable", BUILD)] + [
        _area(1584, name="Blackrock Depths"), _area(1585, parent=1584), _area(133, parent=1, name="Gnomeregan"),
        _area(1, name="Dun Morogh"), _area(209, continent=33, name="Shadowfang Keep")])
    maps = _maps(monkeypatch)
    assert maps.dungeon_of_area(1584, DUNGEON_MAPS) == 230
    assert maps.dungeon_of_area(1585, DUNGEON_MAPS) == 230
    assert maps.dungeon_of_area(133, DUNGEON_MAPS) == 90
    assert maps.dungeon_of_area(209, DUNGEON_MAPS) == 33
    assert maps.dungeon_of_area(1, DUNGEON_MAPS) is None
    assert maps.dungeon_of_area(12, DUNGEON_MAPS) is None


def test_the_excavation_site_is_the_wetlands_not_a_dungeon():
    assert 2998 not in export_compendium.DUNGEONS and 3065 in export_compendium.DUNGEONS


def test_the_dungeons_are_the_table_every_pipeline_shares():
    """pipelines/lib/dungeons.json, which the books' places and Spoken's Data/Dungeons.lua are
    made from too: Forever's City of Dalaran in Alterac Mountains, Ruins of Lordaeron in
    Tirisfal Glades, whose surface ruins its entrance is in."""
    assert export_compendium.INSTANCE_ZONE[2959] == 1416 and 2959 in export_compendium.DUNGEONS
    assert export_compendium.INSTANCE_ZONE[2999] == 1420 and 2999 in export_compendium.DUNGEONS
    assert export_compendium.BATTLEGROUND_ZONE[2997] == 2524


def test_the_builds_are_the_ones_every_pipeline_pins():
    """pipelines/lib/wago.mjs pins the client builds for the Node pipelines; the export reads its
    cache under the same names, so the two must name the same builds."""
    wago = (Path(__file__).resolve().parents[2] / "lib" / "wago.mjs").read_text(encoding="utf-8")
    assert f'export const FOREVER_BUILD = "{BUILD}";' in wago
    assert f'export const ERA_BUILD = "{ERA_BUILD}";' in wago
    assert Path(export_compendium.WAGO_CACHE).parts[-4:] == ("pipelines", "lib", "cache", "wago")


def _tile(area=0, grid=()):
    """A map file as the extractor writes it: a header whose fourth word points at the AREA chunk."""
    offset = 40
    data = bytearray(offset + 8 + (0 if area else 512))
    data[0:4] = b"MAPS"
    data[12:16] = offset.to_bytes(4, "little")
    data[offset:offset + 4] = b"AREA"
    data[offset + 4:offset + 6] = (1 if area else 0).to_bytes(2, "little")
    data[offset + 6:offset + 8] = area.to_bytes(2, "little")
    for i, a in enumerate(grid):
        data[offset + 8 + i * 2:offset + 10 + i * 2] = a.to_bytes(2, "little")
    return bytes(data)


def test_a_map_file_holds_one_area_or_a_grid_of_them():
    assert read_tile(_tile(area=42)) == 42
    assert read_tile(_tile(grid=range(1, 257))) == list(range(1, 257))


def test_a_points_tile_and_cell_are_the_servers():
    # Darkshire's square in Duskwood: the server files it under 0000_51_34.map.
    gx, gy, cell = cell_of(-10567, -1170)
    assert (gx, gy) == (51, 34) and 0 <= cell < 256


def test_the_area_a_giver_stands_in_beats_the_rectangles(monkeypatch, tmp_path):
    gx, gy, cell = cell_of(250, 250)
    grid = [12] * 256
    (tmp_path / f"0000_{gx:02d}_{gy:02d}.map").write_bytes(_tile(grid=grid))
    monkeypatch.setattr(export_compendium, "table", lambda name, locale="enUS", build=BUILD: TABLES[(name, build)])
    maps = Maps(area_at=area_reader(str(tmp_path)))
    # The rectangles say the Wetlands (1437) there; the map file says Elwynn Forest's area.
    assert maps.zone_at(0, 250, 250) == 1429
    # No tile extracted: the rectangle.
    assert maps.zone_at(0, -10567, -1170) == maps.box_at(0, -10567, -1170)
    assert area_reader(str(tmp_path / "none")) is None


def test_the_run_with_the_db_stops_without_map_files_and_names_the_variable(monkeypatch, tmp_path):
    monkeypatch.setattr(export_compendium, "MAPS_DIR", str(tmp_path / "none"))
    monkeypatch.setattr(export_compendium, "area_reader", lambda directory=None: None)
    with pytest.raises(SystemExit, match="COMPENDIUM_MAPS"):
        export_compendium.with_db(export_compendium.parse_args([]))


def test_a_citys_rectangle_wins_over_the_ground_around_it(monkeypatch):
    monkeypatch.setattr(export_compendium, "table", lambda name, locale="enUS", build=BUILD: TABLES[(name, build)])
    maps = Maps(area_at=lambda mapid, x, y: 12)
    monkeypatch.setattr(maps, "box_at", lambda mapid, x, y: 1453)
    assert maps.zone_at(0, 1, 1) == 1453


def test_without_the_db_the_hand_corrections_are_applied_again():
    """--no-db reads each quest's line back and applies the overrides again: a line they leave as
    it was is written back the same, and one written since takes effect."""
    lines = {
        3861: '\t\t[3861] = { "CLUCK!", races = 4294967373 },',
        2: '\t\t[2] = { "Sharptalon\'s \\"Claw\\"", zones = { 1440 }, prev = 6383, ender = 12696, races = 8589934770 },',
        6383: '\t\t[6383] = { "The Ashenvale Hunt", zones = { 1440 }, name = { "Hunt", deDE = "Jagd, \\"die\\" {Hatz}" } },',
        7: '\t\t[7] = { "Kobold Camp Cleanup", sort = "library", enderObject = 99, notext = true },',
    }
    out = export_compendium.reapply_overrides(lines, [{"id": 3861, "zones": [1436, 1420], "source": "test"}])
    assert out[3861] == '\t\t[3861] = { "CLUCK!", zones = { 1436, 1420 }, races = 4294967373 },'
    assert all(out[qid] == lines[qid] for qid in (2, 6383, 7))
