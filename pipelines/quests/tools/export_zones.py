"""The zones the site's explorers filter lines by: corpus/zones.json.

- A quest is in the zones the Compendium files it under (addons/Spoken_Quests/Data/Compendium.lua,
  export_compendium.py): the quest log's own zone, or where its giver stands.
- A speaker is in each zone one of its corpus spawns stands in, placed as the Compendium places a
  giver (Maps.zone_at): the area the server's map files give the point, so this needs them
  (COMPENDIUM_MAPS). Without them a point falls back to the smallest zone rectangle around it, and
  those overlap along every border: the Crossroads landed in Durotar.
- The zones offered are the ones some quest or speaker is in, named as the client names them.

Rerun after `make quests-compendium` or a corpus export, and commit the diff:  make quests-zones
"""
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from export_compendium import CORPUS, MAPS_DIR, OUT as COMPENDIUM, QUESTS, Maps, area_reader, parse_quest_line, read_existing  # noqa: E402

OUT = os.path.join(QUESTS, "corpus", "zones.json")


def quest_zones(quest_lines):
    """{questID: [uiMapID...]} for every quest the Compendium files under a zone."""
    out = {}
    for line in quest_lines.values():
        qid, rec, _, _, _ = parse_quest_line(line)
        if rec["zones"]:
            out[qid] = rec["zones"]
    return out


def speaker_zones(spawns, maps):
    """{"creature:id": [uiMapID...]}, each zone once, in the order the spawns first reach it."""
    out = {}
    for npc in spawns:
        zones = maps.giver_zones(npc, spawns)
        if zones:
            out[npc] = zones
    return out


def zone_names(zones, maps):
    """[{uiMapID, name}] for each zone used, by name."""
    named = [{"uiMapID": z, "name": maps.uimaps[z]["Name_lang"]} for z in zones if z in maps.uimaps]
    return sorted(named, key=lambda zone: zone["name"])


def build(quest_lines, spawns, maps):
    quests = quest_zones(quest_lines)
    speakers = speaker_zones(spawns, maps)
    used = {z for zones in [*quests.values(), *speakers.values()] for z in zones}
    return {
        "_comment": [
            "Where each quest is (the Compendium's zones) and where each speaker stands (its corpus",
            "spawns, through the server's map files), as uiMapIDs, for the explorers' zone filter.",
            "Regenerate with:  make quests-zones",
        ],
        "zones": zone_names(used, maps),
        "quests": {str(qid): zones for qid, zones in sorted(quests.items())},
        "speakers": dict(sorted(speakers.items())),
    }


def render(data):
    # One quest or speaker to a line, so a rerun's diff reads per entry.
    lines = ["{", f'  "_comment": {json.dumps(data["_comment"])},', '  "zones": [']
    lines.append(",\n".join(f"    {json.dumps(zone)}" for zone in data["zones"]))
    lines.append("  ],")
    for key in ("quests", "speakers"):
        lines.append(f'  "{key}": {{')
        lines.append(",\n".join(f"    {json.dumps(k)}: {json.dumps(v)}" for k, v in data[key].items()))
        lines.append("  }," if key == "quests" else "  }")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main():
    area_at = area_reader()
    if not area_at:
        raise SystemExit(f"no map files at {MAPS_DIR}: set COMPENDIUM_MAPS to the repack's data/maps folder")
    quest_lines, _ = read_existing(COMPENDIUM)
    spawns = json.load(gzip.open(CORPUS, "rt", encoding="utf-8")).get("spawns", {})
    data = build(quest_lines, spawns, Maps(area_at=area_at))
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(data))
    print(f"{len(data['quests'])} quests and {len(data['speakers'])} speakers in {len(data['zones'])} zones")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
