"""Keep the addon's voice identities in step with the recording catalogue."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = ROOT / "apps/web/src/lib/combat/lines.json"
LUA_CATALOGUE = ROOT / "addons/Spoken_Combat/Voices.lua"


def lua_catalogue() -> str:
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    lines = ["local _, Combat = ...", "Combat.voices = {"]
    for voice in catalogue["voices"]:
        lines.append(f'    {{ id = "{voice["id"]}", race = "{voice["race"]}", sex = {voice["sex"]}, label = "{voice["label"]}" }},')
    lines.extend(["}", "Combat.clipKeys = { " + ", ".join(f'"{key}"' for key in catalogue["keys"]) + " }", ""])
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = lua_catalogue()
    if args.check:
        if LUA_CATALOGUE.read_text(encoding="utf-8") != expected:
            parser.exit(1, "Combat voice catalogue differs: run python scripts/spoken/combat_catalogue.py\n")
    else:
        LUA_CATALOGUE.write_text(expected, encoding="utf-8")
