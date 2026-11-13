"""Each boss's creature in the Forever repack's world database, and its model.

    py -I pipelines/places/tools/boss_creatures.py [out.json]    (the repack's MySQL running, as for `make compendium`)
    node pipelines/places/tools/write-boss-creatures.mjs out.json

A boss is its `creature_template` of the same name that is spawned on the boss's map; one with no such
creature has none (the maps only Forever has hold no spawns, and a creature of the same name elsewhere
may be a namesake). Its first model is its portrait.
"""
import json
import os
import re
import sys
from pathlib import Path

CLASSIC_MAX = 20000
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "pipelines" / "quests" / "tools"))
import export_compendium as ec  # noqa: E402

text = (ROOT / "addons" / "Spoken_Bosses" / "Data" / "Bosses.lua").read_text(encoding="utf8")
bosses, current = [], None
for line in text.splitlines():
    head = re.match(r"\t\t\[(\d+)\] = \{", line)
    if head:
        current = int(head.group(1))
        continue
    boss = re.search(r'key = "([^"]+)", "((?:[^"\\]|\\.)*)"', line)
    if boss and current:
        bosses.append((current, boss.group(1), re.sub(r"\\(.)", r"\1", boss.group(2))))

# boss-sources.json: the creature ids the research found for each boss on its wiki page.
hints = {(h["map"], h["key"]): h for h in json.loads((ROOT / "pipelines" / "places" / "tools" / "boss-sources.json").read_text(encoding="utf8"))}

cursor = ec.connect(ec.parse_args([])).cursor()
out = []
for map_id, key, name in bosses:
    chosen = None
    ids = [i for i in hints.get((map_id, key), {}).get("npcIds", []) if isinstance(i, int)]
    if ids:
        cursor.execute("SELECT MIN(entry) FROM creature_template WHERE entry IN (%s)" % ",".join(["%s"] * len(ids)), ids)
        row = cursor.fetchone()
        if row and row[0]:
            chosen = row[0]
    if chosen is None:
        cursor.execute("SELECT entry FROM creature_template WHERE name=%s", (name,))
        for (entry,) in cursor.fetchall():
            cursor.execute("SELECT COUNT(*) FROM creature WHERE id=%s AND map=%s", (entry, map_id))
            if cursor.fetchone()[0]:
                chosen = entry
                break
    # The same name can be another creature (Diathorus of Season of Discovery is not the old world elite): the
    # boss then has the guide's model, or no portrait.
    if chosen is None and hints.get((map_id, key), {}).get("noNameMatch"):
        continue
    if chosen is None:
        # Spawned by a script (Ragnaros, the dragons of the world), so with no spawn on the map: the
        # Classic creature of that name, the lowest id under CLASSIC_MAX, and a name that continues the boss's
        # ("Kirtonos" for Kirtonos the Herald) when only one creature does.
        cursor.execute("SELECT MIN(entry) FROM creature_template WHERE name=%s AND entry < %s", (name, CLASSIC_MAX))
        row = cursor.fetchone()
        if row and row[0]:
            chosen = row[0]
        else:
            cursor.execute("SELECT DISTINCT entry FROM creature_template WHERE name LIKE %s AND entry < %s", (name + " %", CLASSIC_MAX))
            rows = cursor.fetchall()
            if len(rows) == 1:
                chosen = rows[0][0]
    if chosen is None:
        continue
    cursor.execute("SELECT CreatureDisplayID FROM creature_template_model WHERE CreatureID=%s ORDER BY Idx LIMIT 1", (chosen,))
    model = cursor.fetchone()
    out.append({"map": map_id, "key": key, "creature": chosen, "display": model[0] if model else None})

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get("TEMP", "."), "boss_creatures.json")
Path(path).write_text(json.dumps(out, indent=1), encoding="utf8")
print(len(bosses), "bosses,", len(out), "with a creature ->", path)
