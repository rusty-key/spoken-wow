"""Every quest, for the Quests tab of Azeroth's Compendium.

Writes addons/Spoken_Quests/Data/Compendium.lua: each quest the corpus holds, with its English
title, where it is, and who can take it. Its words are Data/QuestText.lua's
(tools/export_quest_text.py).

- The quests are the corpus's (corpus/corpus.json.gz): the ones the voice packs were made from.
- Where: the zone the quest belongs to, as the quest log files it (QuestSortID: an AreaTable
  zone, or a dungeon, which counts as the zone its entrance is in), else where its giver stands
  (the corpus's spawns): the area the server's own map files put the point in, as the books'
  places have it (area_reader; COMPENDIUM_MAPS, the repack's maps folder), else the smallest zone
  rectangle around it. A quest of a class, a profession or a season is filed under that
  instead (a negative QuestSortID), named as the client names it, in every language.
- Who: the races and classes allowed to take it (quest_template.AllowableRaces,
  quest_template_addon.AllowableClasses) are read from a TrinityCore world DB (the Forever
  repack's), which the vmangos extraction does not keep. Where the DB opens a quest to every
  race, it is one side's if corpus/factions.json says so, else if the quest before it in its
  chain is (quest_races below).
- Chains: the quest before each one in its storyline (`prev`), from the same DB's
  quest_template_addon (chain_links below), so the tab can group a zone's quests into their chains.
- Hand-in: who a quest is handed in to (`ender`, or `enderObject` for an object), from the same
  DB's creature_questender and gameobject_questender, else the corpus's speaker of the progress or
  complete line; left out where it is the quest's giver (quest_enders below).
- Forever's own quests are almost all missing from the DB, so after it comes what Forever's
  client says of each quest, as players recorded it: Efficient Games' open data (EG Link,
  github.com/JIVESCORP/eg-link-output-wowf, CC BY 4.0; quests.enUS.json and npcs.json, the
  latest build's record of each quest, as the repository had them at EG_COMMIT, cached in
  cache/efficient-games/). Its zone or quest sort, race mask and nextQuestId fill in where the
  DB has none, and change nothing it has. --without-efficient-games leaves it out.
- The zones are uiMapIDs, from the client's own map tables (wago.tools, cached in cache/):
  Forever's, which add its zones and quest sorts to Era's (Mount Hyjal, Zephras Isle, Darkspear
  Islands, Riverglades, Camping, The High Order). Era's fill in anything Forever's lack.
- A dungeon's or a raid's quest (its QuestSortID is the dungeon) is filed under the zone of its
  entrance with `dungeon`, the dungeon's map, so the tab can hold it apart there; the dungeons
  themselves and their names are Spoken's Data/Dungeons.lua (pipelines/lib/dungeons.mjs).
- Forever serves quests the corpus has no lines for yet. Each quest players were seen being
  offered or handing in (npcs.json), or working on (objectives.json), is listed with `notext`,
  placed and limited by its client record as above (without_text below), so the Compendium
  lists it with no words until its lines reach the corpus. Both runs, with the DB or without.
- Last, corpus/compendium_overrides.json: what no source above can say, corrected by hand, each
  correction with its source (a wiki page, or why). It can move, retitle, link, restrict or drop a
  quest, and name a chain (apply_overrides, chain_names below).

With the repack's server up:  make quests-compendium

Without it, `make quests-compendium ARGS=--no-db` keeps every quest the file already has as it is,
but for the hand corrections, applied again so one written since takes effect, and adds the
corpus's quests it lacks: each placed where its giver stands, and open to the races
of the side corpus/factions.json gives it (to everyone where it gives none). A later run with
the database files them as the quest log does.
"""
import argparse
import csv
import gzip
import json
import math
import os
import re
import struct
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
QUESTS = os.path.dirname(HERE)
sys.path.insert(0, QUESTS)

from tts_cli.ignores import ignored_line_ids  # noqa: E402
from tts_cli.quest_text import left_out, lua_string, removed_quests  # noqa: E402

ROOT = os.path.normpath(os.path.join(QUESTS, "..", ".."))
CORPUS = os.path.join(QUESTS, "corpus", "corpus.json.gz")
FACTIONS = os.path.join(QUESTS, "corpus", "factions.json")
IGNORED = os.path.join(QUESTS, "corpus", "ignored.json")
OVERRIDES = os.path.join(QUESTS, "corpus", "compendium_overrides.json")
OUT =os.path.join(ROOT, "addons", "Spoken_Quests", "Data", "Compendium.lua")
CACHE = os.path.join(HERE, "cache")
# The client's tables, in the cache pipelines/lib/wago.mjs keeps for every pipeline, under its
# file names.
WAGO_CACHE = os.path.join(ROOT, "pipelines", "lib", "cache", "wago")
# Forever's client (wago.tools' wow_classic_beta), and Classic Era's: the builds wago.mjs pins
# (tests/test_compendium_tables.py holds them equal). With Era's alone, Forever's own zones and
# sorts resolve to nothing, even where the DB names them.
BUILD = "1.60.1.70338"
ERA_BUILD = "1.15.9.69109"
# Efficient Games' Forever data: what players' Forever clients recorded, per client build (EG Link,
# CC BY 4.0, credited in THIRD_PARTY.md), at one commit of their repository: it grows every day,
# and an export run twice must give the same file. Move it on purpose, and review the diff.
EG_COMMIT = "2ae21542f54d7168ab430d8b6248deb1f8d50a02"
EG_DATA = f"https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/{EG_COMMIT}/data"
EG_PRODUCT = "wow_classic_beta"
EG_CACHE = os.path.join(CACHE, "efficient-games")
LOCALES = ["deDE", "esES", "esMX", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW", "itIT"]

# The dungeons and raids, and the other instances, under the zone their entrance is in, from the
# table every pipeline and the addon share (pipelines/lib/dungeons.json). Forever's Excavation Site
# in the Wetlands, City of Dalaran, Ruins of Lordaeron and Hall of Thanes have no map of their own
# for their areas, so their quests resolved to no zone without it.
with open(os.path.join(ROOT, "pipelines", "lib", "dungeons.json"), encoding="utf-8") as _f:
    _INSTANCES = json.load(_f)
INSTANCE_ZONE = {int(m): row["zone"] for part in ("dungeons", "instances") for m, row in _INSTANCES[part].items()}
# The cities, each inside the zone around it. Ironforge and the Undercity are buildings set into the
# ground, and the map files give a point inside them the ground's area, Dun Morogh's or Tirisfal's;
# there the rectangle, which says city, is kept.
CITY_IN = {1453: 1429, 1454: 1411, 1455: 1426, 1456: 1412, 1457: 1438, 1458: 1420}
# The Forever repack's extracted map files, whose AREA chunks say which area a point is in.
MAPS_DIR = os.environ.get("COMPENDIUM_MAPS", "C:/Forever/ForeverRepack/data/maps")
# The dungeons and raids a quest is filed under (`dungeon`): not the other instances, such as the
# Excavation Site, an instance of the Wetlands' own story (Caitlin Grassman's quests). A map listed
# under both, as the Excavation Site is for the Bosses tab, files its quests as an instance.
DUNGEONS = {int(m) for m in _INSTANCES["dungeons"]} - {int(m) for m in _INSTANCES["instances"]}
# The battlegrounds' maps, and the zone map of each: Alterac Valley, Warsong Gulch, Arathi Basin
# and Forever's Darkspear Islands.
BATTLEGROUND_ZONE = {int(m): row["zone"] for m, row in _INSTANCES["battlegrounds"].items()}
# A giver standing in this many zones or more is a kind of creature found everywhere (CLUCK!'s is
# any chicken) or a post in every capital (the battlemasters, the Argent Dawn's quartermasters).
# Listed in each of them, its quest would count in every one; it is placed by other means or not.
GENERIC_GIVER_ZONES = 4
# The corpus's quest lines.
SOURCES = ["accept", "progress", "complete"]
# The races by side, as AllowableRaces bits (ChrRaces.PlayableRaceBit): Human, Dwarf, Night Elf,
# Gnome and High Order Skyborne; Orc, Undead, Tauren, Troll and Windshaper Skyborne. Classic's
# eight are bits 0-7 (race id less one), Forever's Skyborne 32 and 33.
CLASSIC_RACES = 0xFF
SIDE_RACES = {"alliance": 1 | 4 | 8 | 64 | 1 << 32, "horde": 2 | 16 | 32 | 128 | 1 << 33}
PLAYABLE_RACES = SIDE_RACES["alliance"] | SIDE_RACES["horde"]
# The class each class QuestSort is, as an AllowableClasses bit (class id less one): Warrior,
# Paladin, Hunter, Rogue, Priest, Shaman, Mage, Warlock, Druid.
SORT_CLASS = {81: 1 << 0, 141: 1 << 1, 261: 1 << 2, 162: 1 << 3, 262: 1 << 4, 82: 1 << 6, 161: 1 << 7,
              61: 1 << 8, 263: 1 << 10}


def table(name, locale="enUS", build=BUILD):
    os.makedirs(WAGO_CACHE, exist_ok=True)
    path = os.path.join(WAGO_CACHE, f"{name}-{locale}-{build}.csv")
    if not os.path.exists(path):
        url = f"https://wago.tools/db2/{name}/csv?build={build}&locale={locale}"
        request = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
        with urllib.request.urlopen(request) as response, open(path, "wb") as out:
            out.write(response.read())
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def zone_assignments(uimap_rows, assign_rows):
    """The UiMapAssignment rows of zone maps (UiMap Type 3), and the zone of each area they name."""
    uimap = {int(r["ID"]): r for r in uimap_rows}
    assigns = [a for a in assign_rows if uimap.get(int(a["UiMapID"]), {}).get("Type") == "3"]
    area_zone = {}
    for a in assigns:
        if int(a["AreaID"]) > 0:
            area_zone.setdefault(int(a["AreaID"]), int(a["UiMapID"]))
    return assigns, area_zone


def sort_names(rows_by_locale):
    """{sort: {locale: name}} from each build's QuestSort, the first build's first: a name the
    first leaves out or empty is the next's."""
    sorts = {}
    for locale, builds in rows_by_locale.items():
        for rows in builds:
            for r in rows:
                if r["SortName_lang"]:
                    sorts.setdefault(int(r["ID"]), {}).setdefault(locale, r["SortName_lang"])
    return sorts


GRID = 533.3333333


def read_tile(data):
    """A map file's AREA chunk: one area id for a tile that is all one area, else the 256 of its
    16x16 grid. The file header's fourth word is the chunk's offset."""
    offset = struct.unpack_from("<I", data, 12)[0]
    if data[offset:offset + 4] != b"AREA":
        raise ValueError("no AREA chunk")
    flags, area = struct.unpack_from("<HH", data, offset + 4)
    if flags & 0x0001:
        return area
    return list(struct.unpack_from("<256H", data, offset + 8))


def cell_of(x, y):
    """The tile a point is on and its cell in that tile, as the server computes them
    (GridMap::getArea)."""
    gx = 63 - math.floor(x / GRID + 32)
    gy = 63 - math.floor(y / GRID + 32)
    cx = math.floor(16 * (32 - x / GRID)) & 15
    cy = math.floor(16 * (32 - y / GRID)) & 15
    return gx, gy, cx * 16 + cy


def area_reader(directory=MAPS_DIR):
    """area_at(map, x, y): the AreaTable id the server's map files put a point in, None where no
    tile was extracted. None where there are no map files: then the rectangles place a giver."""
    if not os.path.isdir(directory):
        return None
    tiles = {}

    def area_at(mapid, x, y):
        gx, gy, cell = cell_of(x, y)
        name = f"{mapid:04d}_{gx:02d}_{gy:02d}.map"
        if name not in tiles:
            path = os.path.join(directory, name)
            tiles[name] = read_tile(open(path, "rb").read()) if os.path.exists(path) else None
        tile = tiles[name]
        if tile is None:
            return None
        return (tile if isinstance(tile, int) else tile[cell]) or None

    return area_at


class Maps:
    """The client's zones: which an area is in, and which a point stands in. Forever's tables, then
    Era's for an area or a point Forever's do not place. `area_at` (area_reader) gives the area a
    point is in, where there are map files."""

    def __init__(self, builds=(BUILD, ERA_BUILD), area_at=None):
        self.area_at = area_at
        self.assign_sets, self.area_zone, self.areas, self.uimaps = [], {}, {}, {}
        for build in builds:
            uimaps = table("UiMap", build=build)
            assigns, area_zone = zone_assignments(uimaps, table("UiMapAssignment", build=build))
            self.assign_sets.append(assigns)
            for area, zone in area_zone.items():
                self.area_zone.setdefault(area, zone)
            for r in table("AreaTable", build=build):
                self.areas.setdefault(int(r["ID"]), r)
            for r in uimaps:
                self.uimaps.setdefault(int(r["ID"]), r)
        # A battleground's name, as its map's own area has it: the quest log files some of its
        # quests under another area of that name (Alterac Valley, 2839, in Alterac Mountains).
        self.battlegrounds = {}
        for r in self.areas.values():
            continent = int(r.get("ContinentID") or 0)
            if continent in BATTLEGROUND_ZONE and not int(r.get("ParentAreaID") or 0) and r.get("AreaName_lang"):
                self.battlegrounds[r["AreaName_lang"]] = BATTLEGROUND_ZONE[continent]

    def dungeon_of_area(self, area, dungeons):
        """The dungeon (its map) an area is, is in, or is named after, from `dungeons` ({map:
        Map row}); None for any other. The quest log files a dungeon's quests under its own area,
        under an area of the map outside it (Blackrock Depths', 1584, is on the Eastern Kingdoms
        map), or under an area of its name (Gnomeregan, 133, in Dun Morogh)."""
        by_area = {int(r.get("AreaTableID") or 0): m for m, r in dungeons.items()}
        by_name = {r.get("MapName_lang"): m for m, r in dungeons.items()}
        for _ in range(4):
            row = area and self.areas.get(area)
            if not row:
                return None
            continent = int(row.get("ContinentID") or 0)
            found = (continent if continent in dungeons else None) or by_area.get(area) or by_name.get(row.get("AreaName_lang"))
            if found:
                return found
            area = int(row.get("ParentAreaID") or 0)
        return None

    def battleground_of_area(self, area):
        """The battleground an area is, or is named after; None for any other."""
        row = self.areas.get(area)
        return row and self.battlegrounds.get(row.get("AreaName_lang")) or None

    def zone_of_uimap(self, uimap):
        """The zone map (Type 3) a map is or lies in: a city's district or a dungeon's floor is in
        its zone. None for a continent or the world."""
        for _ in range(6):
            row = self.uimaps.get(uimap)
            if not row or row["Type"] in ("0", "1", "2"):
                return None
            if row["Type"] == "3":
                return uimap
            uimap = int(row["ParentUiMapID"])
        return None

    def zone_of_area(self, area):
        for _ in range(4):
            if not area:
                return None
            if area in self.area_zone:
                return self.area_zone[area]
            row = self.areas.get(area)
            if row and int(row["ContinentID"]) in INSTANCE_ZONE:
                return INSTANCE_ZONE[int(row["ContinentID"])]
            area = int(row["ParentAreaID"]) if row else 0
        return None

    def zone_at(self, mapid, x, y):
        """The zone a point is in: its area's, from the map files, else the smallest zone
        rectangle around it. Rectangles overlap along every border, so a town at a zone's edge
        (Darkshire, Ratchet) fell into its neighbour; a city's rectangle wins over the ground's
        area around it."""
        if mapid in INSTANCE_ZONE:
            return INSTANCE_ZONE[mapid]
        box = self.box_at(mapid, x, y)
        area = self.area_at(mapid, x, y) if self.area_at else None
        zone = area and self.zone_of_area(area)
        if not zone or CITY_IN.get(box) == zone:
            return box
        return zone

    def box_at(self, mapid, x, y):
        """The smallest zone rectangle a point is in."""
        for assigns in self.assign_sets:
            best = None
            for a in assigns:
                if int(a["MapID"]) != mapid:
                    continue
                x0, y0, x1, y1 = (float(a["Region_0"]), float(a["Region_1"]), float(a["Region_3"]), float(a["Region_4"]))
                if min(x0, x1) <= x <= max(x0, x1) and min(y0, y1) <= y <= max(y0, y1):
                    size = abs(x1 - x0) * abs(y1 - y0)
                    if best is None or size < best[0]:
                        best = (size, int(a["UiMapID"]))
            if best:
                return best[1]
        return None

    def giver_zones(self, giver, spawns):
        zones = []
        for s in spawns.get(giver, []):
            z = self.zone_at(int(s["map"]), float(s["x"]), float(s["y"]))
            if z and z not in zones:
                zones.append(z)
        return zones


def corpus_quests(path=CORPUS, ignored_path=IGNORED):
    """{questID: {"title", "giver", "handIn"}}, who each quest is placed by ("creature:id"), and
    the spawns. The one it is placed by is its giver, or for a quest the corpus has no offer of,
    or one an item offers (an item stands nowhere: a Craftsman's Writ would have no place),
    whoever it is handed in to. "giver" is who says its accept line, as the packs' quest log
    tables name the giver; "handIn" who says its progress or complete line. Either is absent
    where the corpus has no such line. A quest QuestText.lua leaves out by the same rule
    (quest_text.left_out: Blizzard's debris, every line ignored) is not one; the hand
    corrections' removals come later, in apply_overrides, which passes chains through them."""
    corpus = json.load(gzip.open(path, "rt", encoding="utf-8"))
    dropped = left_out(corpus, ignored_line_ids(ignored_path))
    quests, givers, enders = {}, {}, {}
    for line in corpus["lines"]:
        qid, source = line.get("questId"), line.get("source")
        if not qid or source not in SOURCES or qid in dropped:
            continue
        quests.setdefault(qid, {"title": line.get("questTitle") or str(qid)})
        if line.get("npcId") and line.get("npcType"):
            npc = f'{line["npcType"]}:{line["npcId"]}'
            if source == "accept":
                if line["npcType"] != "item":
                    givers.setdefault(qid, npc)
                quests[qid].setdefault("giver", npc)
            else:
                enders.setdefault(qid, npc)
                quests[qid].setdefault("handIn", npc)
    for qid, npc in enders.items():
        givers.setdefault(qid, npc)
    return quests, givers, corpus.get("spawns", {})


def fetch(url, path):
    request = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(request) as response:
        data = response.read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as out:
        out.write(data)


def eg_datasets(name):
    """{build: Efficient Games' `name` dataset of that Forever build}, oldest build first, as their
    repository had them at EG_COMMIT. A file at one commit never changes, so each is fetched once
    and read from the cache (cache/efficient-games/<commit>/) after that, offline too."""
    root = os.path.join(EG_CACHE, EG_COMMIT)
    index_path = os.path.join(root, "index.json")
    if not os.path.exists(index_path):
        fetch(f"{EG_DATA}/index.json", index_path)
    with open(index_path, encoding="utf-8") as f:
        builds = json.load(f)["products"].get(EG_PRODUCT, {})
    out = {}
    for build in sorted(builds, key=lambda b: tuple(int(n) for n in b.split("."))):
        if not builds[build].get(name):
            continue
        path = os.path.join(root, build, f"{name}.json")
        if not os.path.exists(path):
            fetch(f"{EG_DATA}/{EG_PRODUCT}/{build}/{name}.json", path)
        with open(path, encoding="utf-8") as f:
            out[build] = json.load(f)
    return out


def forever_quests(quest_sets, npc_sets):
    """Forever's quests as its client has them, from Efficient Games' datasets ({build: data},
    oldest first): {questID: the latest build's record}, and {questID: [uiMapIDs]} where players
    saw an NPC or object offer the quest, else take it in."""
    quests = {}
    for data in quest_sets.values():
        for qid, q in data.get("quests", {}).items():
            quests[int(qid)] = q
    seen = {"offers": {}, "takes": {}}
    for data in npc_sets.values():
        for kind in ("npcs", "objects"):
            for rec in data.get(kind, {}).values():
                maps = {p["uiMap"] for p in rec.get("positions", []) if p.get("uiMap")}
                for key, into in seen.items():
                    for qid in rec.get(key, {}):
                        into.setdefault(int(qid), set()).update(maps)
    where = {}
    for qid in set(seen["offers"]) | set(seen["takes"]):
        maps = seen["offers"].get(qid) or seen["takes"].get(qid)
        if maps:
            where[qid] = sorted(maps)
    return quests, where


def served_quests(npc_sets, objective_sets):
    """The quests players saw Forever serve: offered or taken in at an NPC or object (npcs.json),
    or worked on, a count going up or the quest completing (objectives.json)."""
    served = set()
    for data in npc_sets.values():
        for kind in ("npcs", "objects"):
            for rec in data.get(kind, {}).values():
                served |= {int(q) for key in ("offers", "takes") for q in rec.get(key, {})}
    for data in objective_sets.values():
        for kind in ("quests", "completed"):
            served |= {int(q) for q in data.get(kind, {})}
    return served


def without_text(known, served, client, seen, maps, sorts, removed=()):
    """{questID: record} for the quests Forever serves (`served`) that are not `known` (the corpus's)
    nor `removed`: listed with `notext`, since the corpus has no lines for them yet. Each is placed
    and limited as Forever's client has it (its Efficient Games record, `client`; `seen` where
    players saw its giver), and follows the quest whose nextQuestId names it. A quest the client
    data has no title for is left out: there is nothing to list it by."""
    records = {}
    for qid in sorted(set(served) - set(known) - set(removed)):
        eg = client.get(qid) or {}
        if not eg.get("title"):
            continue
        zones, sort, _ = place(0, maps, sorts, eg, seen.get(qid, ()))
        records[qid] = {"title": eg["title"], "zones": zones, "sort": sort, "dungeon": None,
                        "races": playable_races(eg_races(eg)), "classes": quest_classes(0, sort),
                        "prev": None, "notext": True}
    opened_by = {}
    for qid, eg in sorted(client.items()):
        nxt = int(eg.get("nextQuestId") or 0)
        if nxt in records and (qid in records or qid in known) and qid != nxt:
            opened_by.setdefault(nxt, qid)
    for qid, prev in opened_by.items():
        records[qid]["prev"] = prev
    return records


def eg_races(q):
    """A quest's raceMask (16 hex digits, PlayableRaceBit) as a number, 0 where it has none."""
    return int(q.get("raceMask") or "0", 16)


def place(sort, maps, sorts, eg=None, seen=(), giver_zones=lambda: []):
    """(zones, sort, which source placed it) for a quest, the first that has an answer:

    - the DB's QuestSortID: an area's zone (a battleground's, for an area named after one), or a
      sort the client names (negative);
    - Forever's client (`eg`, its Efficient Games record): its zoneAreaId's zone, or its
      categoryId's sort. A zoneAreaId of a Forever area no map shows (Ruins of Lordaeron, the
      Excavation Site in the Wetlands) is placed where players saw its giver (`seen`, uiMapIDs);
    - where its giver stands (`giver_zones`, from the corpus's spawns);
    - where players saw its giver.
    A giver found in GENERIC_GIVER_ZONES zones or more says nothing of where the quest is, and
    places it nowhere.
    """
    if sort > 0:
        zone = maps.battleground_of_area(sort) or maps.zone_of_area(sort)
        if zone:
            return [zone], None, "db"
    elif sort < 0 and -sort in sorts:
        return [], -sort, "db"

    def seen_zones():
        zones = []
        for uimap in seen:
            zone = maps.zone_of_uimap(uimap)
            if zone and zone not in zones:
                zones.append(zone)
        return zones if len(zones) < GENERIC_GIVER_ZONES else []

    if eg:
        area, category = eg.get("zoneAreaId") or 0, eg.get("categoryId") or 0
        zone = area > 0 and (maps.battleground_of_area(area) or maps.zone_of_area(area))
        if zone:
            return [zone], None, "client"
        if category > 0 and category in sorts:
            return [], category, "client"
        if area > 0 and seen_zones():
            return seen_zones(), None, "client"
    zones = giver_zones()
    if zones and len(zones) < GENERIC_GIVER_ZONES:
        return zones, None, "giver"
    if seen_zones():
        return seen_zones(), None, "client"
    return [], None, None


def battleground_follow_ups(records, givers):
    """File under its battleground a quest that follows one of that battleground's from the same
    giver: a battlemaster's next quest (Fight for Warsong Gulch at each level, Claiming Arathi
    Basin), which the quest log leaves under no zone or under the battlemaster's city. In place."""
    battlegrounds = set(BATTLEGROUND_ZONE.values())
    changed = True
    while changed:
        changed = False
        for qid, rec in records.items():
            prev = records.get(rec.get("prev"))
            if (prev and set(prev["zones"]) & battlegrounds and not set(rec["zones"]) & battlegrounds
                    and givers.get(qid) and givers.get(qid) == givers.get(rec["prev"])):
                rec["zones"], rec["sort"] = list(prev["zones"]), None
                changed = True


def chain_links(rows, known, later=None):
    """{questID: the quest before it in its storyline}, for the quests in `known`.

    `rows` is quest_template_addon as {questID: {"prev", "next", "group", "breadcrumb"}}:
    - PrevQuestID > 0: that quest must be handed in first, so it comes before. A negative one only
      has to be in the log at the time; that quest is not over yet, so it is not "before".
    - NextQuestID: this quest opens that one, which comes after it where it names no PrevQuestID
      of its own. Several quests opening the same one (an ExclusiveGroup: any one of them, or all
      of them) leave the lowest id as the one before.
    - BreadcrumbForQuestId: a breadcrumb leads to its quest, which comes after it where nothing
      else does.
    - `later` ({questID: the quest it opens}, Forever's client's nextQuestId) links a quest only
      where no link of the DB's reaches a quest the corpus has.
    A quest the corpus lacks is passed through to the one before it, and a link that would close a
    loop is dropped, so every chain has a first quest.
    """
    before = {}
    for qid, row in rows.items():
        if (row.get("prev") or 0) > 0:
            before[qid] = row["prev"]
    client_before = {}
    nexts = [{qid: row.get(kind) or 0 for qid, row in rows.items()} for kind in ("next", "breadcrumb")]
    for opens, into in [(n, before) for n in nexts] + [(later or {}, client_before)]:
        opened = {}
        for qid, target in sorted(opens.items()):
            if target > 0 and target != qid:
                opened.setdefault(target, qid)
        for target, qid in opened.items():
            into.setdefault(target, qid)

    # The DB's links first; the client's where the DB's lead to no quest the corpus has (a
    # breadcrumb it lacks, say) or to none at all.
    def known_before(qid):
        for first in (before.get(qid), client_before.get(qid)):
            seen, step = {qid}, first
            while step is not None and step not in known:
                if step in seen:
                    step = None
                    break
                seen.add(step)
                step = before.get(step, client_before.get(step))
            if step is not None:
                return step
        return None

    links = {}
    for qid in sorted(known):
        step = known_before(qid)
        if step is None or step == qid:
            continue
        # Up from the quest before: reaching this one again means the link closes a loop.
        up, steps = step, 0
        while up is not None and up != qid and steps <= len(links):
            up, steps = links.get(up), steps + 1
        if up != qid:
            links[qid] = step
    return links


def playable_races(mask):
    """The playable races a race mask (PlayableRaceBit, as Forever's client has it) lets take a
    quest, 0 for anyone. The bits kept are all below 2^53, so a Lua number holds the mask exactly."""
    races = mask & PLAYABLE_RACES
    return 0 if races == PLAYABLE_RACES else races


def db_races(mask):
    """A DB AllowableRaces as Forever's client has the quest's races.

    The DB's masks are retail's 64 bits, many written before the Skyborne. A mask naming every
    Classic race is anyone, whatever it says of the races past them: the client has the DB's 0xFF
    and 0xFFFFFFFF as everyone. A mask of one side's Classic races is that side's Skyborne too, as
    the client has the DB's 0x4D and 0xB2.
    """
    races = mask & PLAYABLE_RACES
    if races & CLASSIC_RACES == CLASSIC_RACES:
        return 0
    for side in SIDE_RACES.values():
        if races & CLASSIC_RACES == side & CLASSIC_RACES:
            races |= side
    return playable_races(races)


def quest_classes(classes, sort):
    """The classes that may take a quest: the DB's AllowableClasses, else the class of the class
    QuestSort it is filed under. The DB names no class for Forever's class quests, which it lacks,
    nor for a few of its own (8249 Junkboxes Needed), and every class would see those under the
    class."""
    return classes or SORT_CLASS.get(sort, 0)


def side_of(races):
    """The side a race mask is wholly on ("alliance" or "horde"), else None."""
    for side, mask in SIDE_RACES.items():
        if races and not races & ~mask:
            return side
    return None


def gates(rows, later=None):
    """{questID: the quests that open it}, from quest_template_addon as chain_links reads it: its
    PrevQuestID, else every quest whose NextQuestID names it (an ExclusiveGroup's alternatives, or
    all of them), else every quest whose nextQuestId in `later` (Forever's client) names it. A
    breadcrumb opens nothing: its quest can be taken without it."""
    out = {}
    for qid, row in rows.items():
        if (row.get("prev") or 0) > 0:
            out[qid] = {row["prev"]}
    for opens in ({qid: row.get("next") or 0 for qid, row in rows.items()}, later or {}):
        opened = {}
        for qid, target in opens.items():
            if target > 0 and target != qid:
                opened.setdefault(target, set()).add(qid)
        for target, qids in opened.items():
            out.setdefault(target, qids)
    return out


def quest_races(masks, sides, opened_by):
    """{questID: the races that may take it, 0 for anyone}, for the quests of `masks`
    ({questID: its race mask as the client has it: db_races of the DB's AllowableRaces}).

    - The DB's mask, where it limits who may take the quest.
    - Else the side corpus/factions.json gives the quest (its giver's): the DB leaves AllowableRaces
      0 or all for most quests that only one side's giver hands out.
    - Else the side of the quests that open it (`opened_by`, from gates), where they are all one
      side's: a follow-up the DB opens to everyone is still reached only through them. A quest one
      side's quest and the other's both open (The Stone Watcher, after either Seeing What Happens)
      stays open to both. A quest the corpus lacks is passed through to the quests opening it.
    """
    own = {qid: playable_races(mask) or SIDE_RACES.get(sides.get(str(qid)), 0) for qid, mask in masks.items()}
    races = {}

    def side_before(qid, seen):
        found = set()
        for gate in opened_by.get(qid, ()):
            if gate in seen:
                return None
            side = side_of(of(gate, seen)) if gate in own else side_before(gate, seen | {gate})
            if side is None:
                return None
            found.add(side)
        return found.pop() if len(found) == 1 else None

    def of(qid, seen=frozenset()):
        if qid not in races:
            races[qid] = own[qid] or SIDE_RACES.get(side_before(qid, seen | {qid}), 0)
        return races[qid]

    for qid in own:
        of(qid)
    return races


def side_leaks(races, links):
    """[(questID, the quest before it)] where the one before is one side's and the quest is not
    that side's alone: a chain leaking to the other side. The audit's leak check."""
    return [(qid, prev) for qid, prev in sorted(links.items())
            if side_of(races.get(prev, 0)) and side_of(races.get(qid, 0)) != side_of(races.get(prev, 0))]


QUEST_FIELDS = {"title", "zones", "sort", "dungeon", "prev", "races", "classes", "remove"}
CHAIN_FIELDS = {"quest", "name", "names", "source"}


def load_overrides(path=OVERRIDES):
    """The hand corrections: {"quests": [entry...], "chains": [entry...]}, checked.

    A quest entry names its quest (`id`) or quests (`ids`) and sets any of: `title`; `zones` (a
    list of uiMapIDs, which takes the quest out of its sort); `sort` (a QuestSort, or the name of a
    group the client has none for, such as "winterveil"; 0 for none, which takes it out of its
    zones); `dungeon` (the map of the dungeon it is filed under, in the zone of its entrance unless
    `zones` says otherwise; 0 for none); `prev` (the quest before it, 0 for none); `races` and `classes` (masks as the data has
    them); `remove` (true: the quest is left out). A chain entry names a quest of the chain
    (`quest`) and the chain's `name`: a quest's id, whose title the client gives in its own
    language, or words of its own with their translations in `names` ({locale: words}). Every
    entry has a `source`: the wiki page that says so, or why."""
    if not os.path.exists(path):
        return {"quests": [], "chains": []}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for entry in data.get("quests", []):
        unknown = set(entry) - QUEST_FIELDS - {"id", "ids", "source"}
        if unknown or ("id" in entry) == ("ids" in entry) or not entry.get("source"):
            raise ValueError(f"an override needs an id or ids, a source and known fields only: {entry}")
    for entry in data.get("chains", []):
        if set(entry) - CHAIN_FIELDS or "quest" not in entry or "name" not in entry or not entry.get("source"):
            raise ValueError(f"a chain's name needs a quest, a name and a source: {entry}")
    return {"quests": data.get("quests", []), "chains": data.get("chains", [])}


def apply_overrides(records, entries):
    """Apply the hand corrections' quest entries, in order, to `records` ({questID: {"title", "zones",
    "sort", "dungeon", "prev", "races", "classes"}}), in place. A quest dropped is passed through by the quests
    after it, as a quest the corpus lacks is. Returns what could not be applied, as notes."""
    notes, removed = [], {}
    for entry in entries:
        for qid in [entry["id"]] if "id" in entry else entry["ids"]:
            rec = records.get(qid)
            if rec is None:
                if qid not in removed:
                    notes.append(f"{qid}: not in the corpus ({entry['source']})")
                continue
            if entry.get("remove"):
                removed[qid] = rec.get("prev")
                del records[qid]
                continue
            for field in ("title", "races", "classes"):
                if field in entry:
                    rec[field] = entry[field]
            if "prev" in entry:
                rec["prev"] = entry["prev"] or None
            if "dungeon" in entry:
                rec["dungeon"] = entry["dungeon"] or None
                if rec["dungeon"]:
                    rec["zones"], rec["sort"] = [INSTANCE_ZONE[rec["dungeon"]]], None
            if "zones" in entry:
                rec["zones"], rec["sort"] = list(entry["zones"]), None
            if "sort" in entry:
                rec["sort"], rec["dungeon"] = entry["sort"] or None, None
                rec["zones"] = []
    for qid, rec in records.items():
        prev, seen = rec.get("prev"), set()
        while prev in removed and prev not in seen:
            seen.add(prev)
            prev = removed[prev]
        if prev is not None and prev not in records:
            notes.append(f"{qid}: the quest before it, {prev}, is not in the data")
            prev = None
        rec["prev"] = prev
    for qid in records:
        if first_of(records, qid) is None:
            raise ValueError(f"the overrides close a loop of chain links through {qid}")
    return notes


def first_of(records, qid):
    """The first quest of `qid`'s chain, None where the links loop."""
    seen = {qid}
    while records[qid].get("prev"):
        qid = records[qid]["prev"]
        if qid in seen:
            return None
        seen.add(qid)
    return qid


def chain_names(records, entries):
    """{first quest of a chain: its name}, from the hand corrections' chain entries: one name for
    the whole chain, in every zone it crosses. A name is a quest's id or {locale: words}. Returns
    the names and what could not be applied, as notes."""
    names, notes = {}, []
    for entry in entries:
        if entry["quest"] not in records:
            notes.append(f"chain of {entry['quest']}: not in the data ({entry['source']})")
            continue
        name = entry["name"]
        if isinstance(name, int):
            if name not in records:
                notes.append(f"chain of {entry['quest']}: its name's quest {name} is not in the data")
                continue
        else:
            name = {"enUS": name, **entry.get("names", {})}
        root = first_of(records, entry["quest"])
        if root in names and names[root] != name:
            notes.append(f"chain of {entry['quest']}: {root} is named already")
            continue
        names[root] = name
    return names, notes


def quest_enders(rows, quests):
    """{questID: "creature:id" or "gameobject:id"}, who each quest is handed in to, where that is
    not its giver: the progress and complete lines are said by that one.

    `rows` are the DB's (kind, id, questID), from creature_questender and gameobject_questender;
    `quests` corpus_quests' records. Of several the DB names, the corpus's speaker of the hand-in
    wins, then the giver, then the lowest creature, then the lowest object. A quest the DB names
    none for takes the corpus's speaker. The giver is left out: the tab falls back to it."""
    named = {}
    for kind, npc, qid in rows:
        named.setdefault(qid, set()).add((kind, int(npc)))
    enders = {}
    for qid, quest in quests.items():
        giver, spoken = quest.get("giver"), quest.get("handIn")
        candidates = [f"{kind}:{npc}" for kind, npc in sorted(named.get(qid, ()),
                                                              key=lambda c: (c[0] != "creature", c[1]))]
        if not candidates or spoken in candidates:
            ender = spoken
        elif giver in candidates:
            ender = giver
        else:
            ender = candidates[0]
        if ender and ender != giver and ender.split(":")[0] in ("creature", "gameobject"):
            enders[qid] = ender
    return enders


def sort_line(sid, names):
    """A QuestSort's line: its English name, then each language's that differs."""
    locs = [f"{l} = {lua_string(names[l])}" for l in LOCALES if names.get(l) and names[l] != names.get("enUS")]
    return f"\t\t[{sid}] = {{ {', '.join([lua_string(names.get('enUS', str(sid)))] + locs)} }},"


class LuaText(str):
    """Lua written as it is: a chain's name read back from a file this wrote (parse_quest_line)."""


def lua_name(name):
    if isinstance(name, LuaText):
        return str(name)
    if isinstance(name, int):
        return str(name)
    locs = [f"{l} = {lua_string(name[l])}" for l in LOCALES if name.get(l)]
    return "{ %s }" % ", ".join([lua_string(name["enUS"])] + locs)


def quest_line(qid, title, zones=(), group=None, races=0, classes=0, prev=None, name=None, dungeon=None,
               ender=None, notext=False):
    parts = [lua_string(title)]
    if zones:
        parts.append("zones = { %s }" % ", ".join(str(z) for z in zones))
    if dungeon and zones:
        parts.append(f"dungeon = {dungeon}")
    if isinstance(group, str):
        parts.append(f"sort = {lua_string(group)}")
    elif group:
        parts.append(f"sort = {group}")
    if prev:
        parts.append(f"prev = {prev}")
    if name is not None:
        parts.append(f"name = {lua_name(name)}")
    if ender:
        kind, npc = ender.split(":")
        parts.append(f"{'enderObject' if kind == 'gameobject' else 'ender'} = {npc}")
    # Every race or class, or none named, is anyone, and goes unsaid. Classes are Classic's nine
    # (bits by id less one); the DB's "all" is every bit set.
    races = playable_races(races)
    if races:
        parts.append(f"races = {races}")
    classes = classes & 0x5DF
    if classes and classes != 0x5DF:
        parts.append(f"classes = {classes}")
    if notext:
        parts.append("notext = true")
    return f"\t\t[{qid}] = {{ {', '.join(parts)} }},"


def render(quest_lines, sort_lines):
    return f"""-- AUTO-GENERATED by pipelines/quests/tools/export_compendium.py. Do not edit by hand.
--
-- Every quest the voice packs were made from, for the Quests tab of Azeroth's Compendium:
-- {{ English title, zones = {{ uiMapID... }} or sort = a QuestSort (a class, a profession, a
-- season), races and classes = who may take it (bit masks: a race's PlayableRaceBit, Skyborne's
-- 32 and 33, and a class's id less one; absent for anyone), prev = the quest before it in its
-- chain, name = the chain's name on its first quest (a quest's id, whose title names it, or words
-- by locale), dungeon = the map of the dungeon or raid it is a quest of (Spoken's Data/Dungeons.lua
-- names it), filed under the zone of its entrance, ender = the creature it is handed in to
-- (enderObject for an object), absent where that is its giver, notext = true for a quest Forever
-- serves that the corpus has no words for yet }}. A sort that is a word is a group the client has
-- no QuestSort for. The words are Data/QuestText.lua's. Made from the client tables of
-- Forever {BUILD} and Era {ERA_BUILD} (wago.tools) and Efficient Games' data
-- at commit {EG_COMMIT[:7]} (CC BY 4.0, efficient.games).
-- Regenerate with the Forever repack's world DB up:
--   make quests-compendium
-- or, adding only the corpus's new quests, without it:  make quests-compendium ARGS=--no-db
--
-- Where Forever's quests are filed, who may take them and which follows which come partly from
-- data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.
--
-- A global rather than a private namespace: a data file cannot reach into the addon's environment.

SpokenQuestsCompendium = {{
\tversion = 1,

\tquests = {{
{chr(10).join(line for _, line in sorted(quest_lines.items()))}
\t}},

\tsorts = {{
{chr(10).join(line for _, line in sorted(sort_lines.items()))}
\t}},
}}
"""


ENTRY = re.compile(r"^\t\t\[(-?\d+)\] = \{ .* \},$")


def _lua_value(text, at):
    """The Lua value at `at` in `text` (a number, a word, a string or a table, strings in it read
    whole) and where it ends."""
    if text[at] == '"':
        end = at + 1
        while text[end] != '"':
            end += 2 if text[end] == "\\" else 1
        return text[at:end + 1], end + 1
    if text[at] == "{":
        depth, end = 0, at
        while True:
            if text[end] == '"':
                _, end = _lua_value(text, end)
                continue
            depth += {"{": 1, "}": -1}.get(text[end], 0)
            end += 1
            if depth == 0:
                return text[at:end], end
    end = at
    while end < len(text) and text[end] not in ", }":
        end += 1
    return text[at:end], end


def _lua_unstring(text):
    out, i = [], 1
    while i < len(text) - 1:
        if text[i] == "\\":
            nxt = text[i + 1]
            if nxt.isdigit():
                out.append(chr(int(text[i + 1:i + 4])))
                i += 4
                continue
            out.append({"n": "\n"}.get(nxt, nxt))
            i += 2
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def parse_quest_line(line):
    """A quest's line as quest_line writes it, back into (qid, its record, its chain's name as Lua
    text, its ender as kind:id, notext)."""
    qid = int(ENTRY.match(line).group(1))
    body = line[line.index("{ ") + 2:line.rindex(" },")]
    title, at = _lua_value(body, 0)
    fields = {}
    while at < len(body):
        at = body.index(", ", at) + 2
        key, at = body[at:body.index(" = ", at)], body.index(" = ", at) + 3
        fields[key], at = _lua_value(body, at)
    number = lambda key: int(fields[key]) if key in fields else None
    sort = fields.get("sort")
    rec = {"title": _lua_unstring(title),
           "zones": [int(z) for z in re.findall(r"-?\d+", fields["zones"])] if "zones" in fields else [],
           "sort": _lua_unstring(sort) if sort and sort.startswith('"') else (int(sort) if sort else None),
           "dungeon": number("dungeon"), "prev": number("prev"), "races": number("races") or 0,
           "classes": number("classes") or 0}
    ender = ("creature:" + fields["ender"]) if "ender" in fields else \
        ("gameobject:" + fields["enderObject"]) if "enderObject" in fields else None
    name = LuaText(fields["name"]) if "name" in fields else None
    return qid, rec, name, ender, fields.get("notext") == "true"


def reapply_overrides(quest_lines, entries):
    """`quest_lines` with the hand corrections' quest entries applied again, as a run with the DB
    applies them last: the lines they leave as they were come out the same, so an override written
    since takes effect without the database."""
    parsed = {qid: parse_quest_line(line) for qid, line in quest_lines.items()}
    records = {qid: rec for qid, (_, rec, _, _, _) in parsed.items()}
    apply_overrides(records, entries)
    out = {}
    for qid, rec in records.items():
        _, _, name, ender, notext = parsed[qid]
        out[qid] = quest_line(qid, rec["title"], rec["zones"], rec["sort"], rec["races"], rec["classes"], rec["prev"],
                              name, rec.get("dungeon"), ender, notext)
    return out


def read_existing(path):
    """The quest and sort lines of a file this wrote, as they are. An older file's dungeon names
    are left behind: Spoken's Data/Dungeons.lua has them."""
    quest_lines, sort_lines, into = {}, {}, None
    with open(path, encoding="utf-8") as f:
        for line in f.read().splitlines():
            if line == "\tquests = {":
                into = quest_lines
            elif line == "\tsorts = {":
                into = sort_lines
            elif line == "\t},":
                into = None
            elif into is not None and ENTRY.match(line):
                into[int(ENTRY.match(line).group(1))] = line
    return quest_lines, sort_lines


def without_db(args):
    quests, givers, spawns = corpus_quests()
    enders = quest_enders([], quests)
    quest_lines, sort_lines = read_existing(args.out)
    # Every hand correction, as the last run with the DB applied them and any written since.
    quest_lines = reapply_overrides(quest_lines, load_overrides()["quests"])
    # Listed without words last time: made again below, or now the corpus's.
    quest_lines = {qid: line for qid, line in quest_lines.items() if "notext = true" not in line}
    with open(FACTIONS, encoding="utf-8") as f:
        sides = json.load(f).get("sides", {})
    maps = Maps(area_at=area_reader())
    records = {}
    for qid in sorted(set(quests) - set(quest_lines)):
        zones = maps.giver_zones(givers[qid], spawns) if qid in givers else []
        records[qid] = {"title": quests[qid]["title"], "zones": zones, "sort": None, "dungeon": None,
                        "races": SIDE_RACES.get(sides.get(str(qid)), 0), "classes": 0, "prev": None}
    # The hand corrections, for the quests added: the rest are as the last run with the DB left them.
    added = set(records)
    entries = [e for e in load_overrides()["quests"] if added & set([e["id"]] if "id" in e else e["ids"])]
    apply_overrides(records, entries)
    unvoiced = {}
    if not args.without_efficient_games:
        client, seen = forever_quests(eg_datasets("quests.enUS"), eg_datasets("npcs"))
        sorts = sort_names({locale: [table("QuestSort", locale, build) for build in (BUILD, ERA_BUILD)]
                            for locale in ["enUS"] + LOCALES})
        served = served_quests(eg_datasets("npcs"), eg_datasets("objectives"))
        unvoiced = without_text(quests, served, client, seen, maps, sorts, removed_quests(OVERRIDES))
        for sid in {rec["sort"] for rec in unvoiced.values() if isinstance(rec["sort"], int)} - set(sort_lines):
            sort_lines[sid] = sort_line(sid, sorts[sid])
        records.update(unvoiced)
    for qid, rec in records.items():
        quest_lines[qid] = quest_line(qid, rec["title"], rec["zones"], rec["sort"], rec["races"], rec["classes"],
                                      rec["prev"] if rec["prev"] in quest_lines or rec["prev"] in records else None,
                                      ender=enders.get(qid), notext=rec.get("notext"))
    placed = sum(1 for rec in records.values() if rec["zones"])
    return quest_lines, sort_lines, (f"{len(records) - len(unvoiced)} quests added, "
                                                    f"{len(unvoiced)} listed without words, {placed} of them placed")


def connect(args):
    import pymysql

    return pymysql.connect(host=args.host, port=args.port, user=args.user, password=args.password,
                           database=args.database, charset="utf8mb4")


def with_db(args):
    quests, givers, spawns = corpus_quests()
    maps = Maps(area_at=area_reader())
    if not maps.area_at:
        print(f"no map files at {MAPS_DIR} (COMPENDIUM_MAPS): givers are placed by zone rectangles")
    db = connect(args)
    ids = sorted(quests)
    marks = ",".join(["%s"] * len(ids))
    with db.cursor() as cur:
        cur.execute(f"SELECT ID, QuestSortID, AllowableRaces FROM quest_template WHERE ID IN ({marks})", ids)
        for qid, sort, races in cur.fetchall():
            quests[qid]["sort"], quests[qid]["races"] = int(sort), db_races(int(races or 0))
        cur.execute(f"SELECT ID, AllowableClasses FROM quest_template_addon WHERE ID IN ({marks})", ids)
        for qid, classes in cur.fetchall():
            quests[qid]["classes"] = int(classes or 0)
        # Every quest's links, not only the corpus's: a chain can pass through a quest it lacks.
        # Breadcrumbs are a later column some world DBs do not have.
        cur.execute("SHOW COLUMNS FROM quest_template_addon LIKE 'BreadcrumbForQuestId'")
        breadcrumb = ", BreadcrumbForQuestId" if cur.fetchall() else ", 0"
        cur.execute(f"SELECT ID, PrevQuestID, NextQuestID, ExclusiveGroup{breadcrumb} FROM quest_template_addon")
        rows = {int(qid): {"prev": int(prev or 0), "next": int(nxt or 0), "group": int(group or 0),
                           "breadcrumb": int(crumb or 0)}
                for qid, prev, nxt, group, crumb in cur.fetchall()}
        ender_rows = []
        for kind in ("creature", "gameobject"):
            cur.execute(f"SELECT id, quest FROM {kind}_questender WHERE quest IN ({marks})", ids)
            ender_rows += [(kind, int(npc), int(qid)) for npc, qid in cur.fetchall()]
    db.close()
    enders = quest_enders(ender_rows, quests)
    # Forever's client after the DB, which has almost none of Forever's own quests: it adds
    # links, races and places where the DB has none, and changes none the DB has.
    if args.without_efficient_games:
        client, seen = {}, {}
    else:
        client, seen = forever_quests(eg_datasets("quests.enUS"), eg_datasets("npcs"))
    client_next = {qid: int(q["nextQuestId"]) for qid, q in client.items() if q.get("nextQuestId")}
    links = chain_links(rows, set(ids), client_next)
    with open(FACTIONS, encoding="utf-8") as f:
        sides = json.load(f).get("sides", {})
    masks = {}
    for qid in ids:
        masks[qid] = quests[qid].get("races", 0)
        if not playable_races(masks[qid]) and qid in client:
            masks[qid] = eg_races(client[qid])
    races = quest_races(masks, sides, gates(rows, client_next))
    leaks = side_leaks(races, links)

    sorts = sort_names({locale: [table("QuestSort", locale, build) for build in (BUILD, ERA_BUILD)]
                        for locale in ["enUS"] + LOCALES})
    dungeon_rows = {int(r["ID"]): r for r in table("Map") if int(r["ID"]) in DUNGEONS}

    by_client = 0
    records = {}
    for qid in ids:
        q = quests[qid]
        zones, group, source = place(
            q.get("sort", 0), maps, sorts, client.get(qid), seen.get(qid, ()),
            lambda: maps.giver_zones(givers[qid], spawns) if qid in givers else [])
        by_client += 1 if source == "client" else 0
        title = q["title"]
        if title == str(qid) and client.get(qid, {}).get("title"):
            title = client[qid]["title"]
        # A dungeon's quest, by the DB's QuestSortID, else the client's zone where the DB has
        # none: in the zone of the dungeon's entrance, wherever its giver stands.
        area = q.get("sort", 0) if q.get("sort", 0) > 0 else 0
        if not area and not q.get("sort") and qid in client:
            area = client[qid].get("zoneAreaId") or 0
        dungeon = maps.dungeon_of_area(area, dungeon_rows) if area > 0 else None
        if dungeon:
            zones, group = [INSTANCE_ZONE[dungeon]], None
        records[qid] = {"title": title, "zones": zones, "sort": group, "dungeon": dungeon, "races": races[qid],
                        "classes": quest_classes(q.get("classes", 0), group), "prev": links.get(qid)}

    if not args.without_efficient_games:
        served = served_quests(eg_datasets("npcs"), eg_datasets("objectives"))
        records.update(without_text(quests, served, client, seen, maps, sorts, removed_quests(OVERRIDES)))

    battleground_follow_ups(records, givers)
    overrides = load_overrides()
    notes = apply_overrides(records, overrides["quests"])
    named, name_notes = chain_names(records, overrides["chains"])
    for note in notes + name_notes:
        print(f"override not applied: {note}")

    placed = unplaced = by_sort = 0
    quest_lines, used_sorts = {}, set()
    for qid, rec in records.items():
        if rec["sort"] and not isinstance(rec["sort"], str):
            used_sorts.add(rec["sort"])
        if rec["zones"]:
            placed += 1
        elif rec["sort"]:
            by_sort += 1
        else:
            unplaced += 1
        quest_lines[qid] = quest_line(qid, rec["title"], rec["zones"], rec["sort"], rec["races"], rec["classes"],
                                      rec["prev"], named.get(qid), rec.get("dungeon"), enders.get(qid),
                                      rec.get("notext"))

    sort_lines = {sid: sort_line(sid, sorts[sid]) for sid in sorted(used_sorts)}
    return quest_lines, sort_lines, (f"{placed} in a zone ({sum(1 for r in records.values() if r.get('dungeon') and r['zones'])} "
                                     f"of a dungeon or raid), {by_sort} under a class, profession or season, "
                                     f"{unplaced} with no place ({by_client} placed by Forever's client); "
                                     f"{len(used_sorts)} sorts; "
                                     f"{sum(1 for r in records.values() if r['prev'])} after another in a chain, "
                                     f"{len(named)} chains named by hand; "
                                     f"{sum(1 for qid in records if qid in enders)} handed in to another than their giver; "
                                     f"{sum(1 for m in races.values() if m)} limited by race, "
                                     f"{len(leaks)} not on the side of the quest before them; "
                                     f"{len(ids) - len(records)} dropped by hand")


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-db", action="store_true", help="add the corpus's new quests without a database")
    ap.add_argument("--without-efficient-games", action="store_true",
                    help="leave Efficient Games' Forever client data out: the DB and the corpus alone")
    ap.add_argument("--host", default=os.environ.get("COMPENDIUM_MYSQL_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("COMPENDIUM_MYSQL_PORT", "3317")))
    ap.add_argument("--user", default=os.environ.get("COMPENDIUM_MYSQL_USER", "root"))
    ap.add_argument("--password", default=os.environ.get("COMPENDIUM_MYSQL_PASSWORD", ""))
    ap.add_argument("--database", default=os.environ.get("COMPENDIUM_MYSQL_DATABASE", "world"))
    ap.add_argument("--out", default=OUT)
    return ap.parse_args(argv)


def main():
    args = parse_args()
    quest_lines, sort_lines, summary = (without_db if args.no_db else with_db)(args)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(quest_lines, sort_lines))
    print(f"{len(quest_lines)} quests: {summary}; {os.path.getsize(args.out) // 1024} KB")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
