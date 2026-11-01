"""Export localized quest wording for Azeroth's Compendium from a TrinityCore dump.

The Classic client exposes localized quest text only after the quest window has been shown.
The Compendium also lists unstarted quests, so the addon needs a shipped fallback for those
pages.  TDB 3.3.5 contains the pre-Cataclysm locale tables used here:

    python tools/export_compendium_locale_text.py \
        --tdb /path/to/TDB_full_world_335.sql \
        --locale esES --locale esMX \
        --cache /path/to/Cache/WDB/esES/questcache.wdb \
        --cache /path/to/Cache/WDB/esMX/questcache.wdb \
        --pfquest-esES /path/to/pfQuest/db/esES/quests.lua \
        --out ../../../addons/Spoken_Quests/Data/LocalizedQuestText.lua

Only quests already present in Data/Compendium.lua are exported.  The source dump is kept out
of the repository; rerunning this command reproduces the generated addon data.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
QUESTS_ROOT = HERE.parents[3]
TOOLS = HERE.parent
sys.path.insert(0, str(TOOLS))

from fill_locales_from_tdb import WORLD_335, read_tables  # noqa: E402
from fill_locales_from_pfquest import read_quests  # noqa: E402
from questcache import quest_texts  # noqa: E402


def compendium_ids(path: Path) -> set[int]:
    # Compendium.lua is generated data, and this deliberately avoids executing it outside WoW.
    return {int(match.group(1)) for match in re.finditer(
        r"^\s*\[(\d+)\]\s*=\s*\{", path.read_text(), re.MULTILINE)}


def clean(text: str | None) -> str | None:
    if not text:
        return None
    # TDB has both spellings in old rows; the addon accepts either, but one spelling keeps the
    # generated data stable and matches the committed English corpus.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", "$B")
    text = re.sub(r"\$b", "$B", text)
    text = text.strip()
    return text or None


def lua_string(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tdb", type=Path, required=True, help="extracted TDB 3.3.5 world SQL dump")
    parser.add_argument("--locale", action="append", required=True, help="client locale to export (repeatable)")
    parser.add_argument("--cache", type=Path, action="append", default=[],
                        help="optional Classic questcache.wdb; repeat for each locale")
    parser.add_argument("--pfquest-esES", type=Path,
                        help="optional pfQuest esES quests.lua to improve the esES fallback")
    parser.add_argument("--out", type=Path, required=True, help="Lua file to write")
    args = parser.parse_args()

    wanted_locales = set(args.locale)
    ids = compendium_ids(QUESTS_ROOT / "addons/Spoken_Quests/Data/Compendium.lua")

    def keep(_table: str, row: dict) -> bool:
        return row.get("locale") in wanted_locales and int(row["ID"]) in ids

    tables = read_tables(args.tdb, {
        "quest_template_locale": WORLD_335["quest_template_locale"],
        "quest_offer_reward_locale": WORLD_335["quest_offer_reward_locale"],
    }, keep)

    quests: dict[str, dict[int, dict[str, str]]] = {locale: {} for locale in args.locale}
    for row in tables["quest_template_locale"]:
        quest = quests[row["locale"]].setdefault(int(row["ID"]), {})
        # QuestDescription is what the quest giver says in the description section. The client
        # separately shows LogDescription as objectives, which is intentionally not spoken here.
        quest["title"] = clean(row["LogTitle"]) or quest.get("title")
        quest["accept"] = clean(row["QuestDescription"]) or quest.get("accept")

    for row in tables["quest_offer_reward_locale"]:
        quest = quests[row["locale"]].setdefault(int(row["ID"]), {})
        quest["complete"] = clean(row["RewardText"]) or quest.get("complete")

    source_notes = []
    if args.pfquest_esES:
        source_notes.append("pfQuest esES")
        for quest_id, fields in read_quests(args.pfquest_esES.read_text()).items():
            if quest_id not in ids:
                continue
            quest = quests["esES"].setdefault(quest_id, {})
            quest["title"] = clean(fields.get("Title")) or quest.get("title")
            quest["accept"] = clean(fields.get("Details")) or quest.get("accept")

    cache_sources = []
    for cache in args.cache:
        cache_locale, cache_build, cached = quest_texts(cache)
        if cache_locale not in wanted_locales:
            parser.error(f"--cache {cache} is {cache_locale}, but --locale does not include it")
        cache_sources.append(f"{cache_locale} Classic quest cache build {cache_build}")
        for quest_id, fields in cached.items():
            if quest_id not in ids:
                continue
            quest = quests[cache_locale].setdefault(quest_id, {})
            quest["title"] = clean(fields.get("title")) or quest.get("title")
            quest["accept"] = clean(fields.get("questDescription")) or quest.get("accept")
            # Some cache records do not carry the completion line; retain TDB's localized reward
            # text in that case, while using the cache wherever it has the exact client wording.
            quest["complete"] = clean(fields.get("completionLog")) or quest.get("complete")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "-- AUTO-GENERATED by pipelines/quests/tools/export_compendium_locale_text.py. Do not edit by hand.",
        "--",
        f"-- Source: TrinityCore TDB 3.3.5 quest locale tables; {', '.join(source_notes + cache_sources) or 'no supplemental source'}.",
        "-- Regenerate with the command in the generator's module docstring, using matching sources.",
        "-- Only localized title, offer text, and reward text are included; progress text is not used", 
        "-- by the Compendium page.",
        "",
        "SpokenQuestsLocalizedText = {",
    ]
    for locale in args.locale:
        lines.append(f"\t{locale} = {{")
        for quest_id in sorted(quests[locale]):
            fields = quests[locale][quest_id]
            if not any(fields.get(moment) for moment in ("title", "accept", "complete")):
                continue
            lines.append(f"\t\t[{quest_id}] = {{")
            for moment in ("title", "accept", "complete"):
                value = fields.get(moment)
                if value:
                    lines.append(f"\t\t\t{moment} = {lua_string(value)},")
            lines.append("\t\t},")
        lines.append("\t},")
    lines.append("}")
    args.out.write_text("\n".join(lines) + "\n")

    counts = {locale: sum(1 for fields in quests[locale].values()
                          if any(fields.get(moment) for moment in ("title", "accept", "complete")))
              for locale in args.locale}
    print(f"exported {len(ids)} Compendium quest ids from {args.tdb}", file=sys.stderr)
    for locale in args.locale:
        print(f"  {locale}: {counts[locale]} localized quest records", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
