"""Each boss's creature in the Forever repack's world database, and the spells it casts there.

    py -I pipelines/places/tools/boss_creatures.py [out.json]    (the repack's MySQL running, as for `make compendium`)
    node pipelines/places/tools/write-boss-creatures.mjs out.json

A boss is its `creature_template` of the same name that is spawned on the boss's map; one with no such
creature has none (the maps only Forever has hold no spawns, and a creature of the same name elsewhere
may be a namesake). Its first model is its portrait. Spells are the ones its smart scripts cast (with the actionlists
they call) and its template lists, and those of the other members of a fight of several (`members` in
boss-sources.json); the rest are cast by code the database does not hold, so the list is never the whole fight.
`live` is what Efficient Games recorded the creature casting in players' Forever clients (EG Link, CC BY 4.0), also
for a boss only Forever has, whose creature is in boss-creatures-manual.json.
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

text = (ROOT / "addons" / "Spoken_NPCs" / "Data" / "Bosses.lua").read_text(encoding="utf8")
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

# The creatures only Forever has, which the database does not hold.
manual = {(e["map"], e["key"]): e["creature"] for e in json.loads((ROOT / "pipelines" / "places" / "tools" / "boss-creatures-manual.json").read_text(encoding="utf8")) if e.get("creature")}

live_casts = {}
for data in ec.eg_datasets("creatures").values():
    for creature, record in data.get("creatures", {}).items():
        live_casts.setdefault(int(creature), set()).update(int(s) for s in record.get("combatLog", {}).get("casts", {}))

cursor = ec.connect(ec.parse_args([])).cursor()
SMART = "SELECT action_type, action_param1, action_param2, action_param3, action_param4, action_param5, action_param6 FROM smart_scripts"


def casts(entry):
    """The spells `entry` casts in the database, in id order."""
    spells = set()
    cursor.execute(SMART + " WHERE source_type=0 AND entryorguid=%s", (entry,))
    rows, seen = cursor.fetchall(), set()
    while rows:
        # Actionlists (Antu'sul's totems, Thekal's transform): called by id (80), one of several (87) or of a range (88).
        lists = set()
        for action, *params in rows:
            if action in (11, 85):
                spells.add(params[0])
            elif action == 80:
                lists.add(params[0])
            elif action == 87:
                lists.update(p for p in params if p)
            elif action == 88 and 0 <= params[1] - params[0] < 100:
                lists.update(range(params[0], params[1] + 1))
        lists -= seen
        seen |= lists
        if not lists:
            break
        cursor.execute(SMART + " WHERE source_type=9 AND entryorguid IN (%s)" % ",".join(["%s"] * len(lists)), sorted(lists))
        rows = cursor.fetchall()
    cursor.execute("SELECT DISTINCT Spell FROM creature_template_spell WHERE CreatureID=%s", (entry,))
    spells.update(row[0] for row in cursor.fetchall())
    spells.discard(0)
    return sorted(spells)


def in_turn(lists):
    """One of each list in turn, each once: the cap on a boss's spells then leaves no member of a fight out."""
    out = []
    for k in range(max(map(len, lists), default=0)):
        for spells in lists:
            if k < len(spells) and spells[k] not in out:
                out.append(spells[k])
    return out


out = []
for map_id, key, name in bosses:
    # The creature boss-creatures-manual.json names is the one the card shows (write-boss-creatures.mjs puts it
    # in `creature`), so its casts are the ones read, not those of a creature the database matches by name or hint.
    chosen = manual.get((map_id, key))
    ids = [i for i in hints.get((map_id, key), {}).get("npcIds", []) if isinstance(i, int)]
    if ids and chosen is None:
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
    # boss then has what the guide and the wiki list, and no portrait.
    if chosen is None and not hints.get((map_id, key), {}).get("noNameMatch"):
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
    members = [chosen] + hints.get((map_id, key), {}).get("members", [])
    spells = in_turn([casts(c) for c in members])
    live = in_turn([sorted(live_casts.get(c, ())) for c in members])
    cursor.execute("SELECT CreatureDisplayID FROM creature_template_model WHERE CreatureID=%s ORDER BY Idx LIMIT 1", (chosen,))
    model = cursor.fetchone()
    out.append({"map": map_id, "key": key, "creature": chosen, "display": model[0] if model else None, "spells": spells, "live": live})

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get("TEMP", "."), "boss_creatures.json")
Path(path).write_text(json.dumps(out, indent=1), encoding="utf8")
print(len(bosses), "bosses,", len(out), "with a creature,", sum(1 for b in out if b["spells"]), "with spells ->", path)
