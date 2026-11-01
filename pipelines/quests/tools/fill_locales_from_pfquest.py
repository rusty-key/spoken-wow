"""
Fill a language's quest titles, objectives and descriptions in the vmangos world DB from
pfQuest's database.

No database dump carries Brazilian Portuguese quest text worth having: vmangos has no column
for it, and TrinityCore's retail rows are mostly English filed under ptBR (see
fill_locales_from_tdb.py's untranslated()). pfQuest (https://github.com/shagu/pfquest) ships
each language's quest text as Lua tables, db/<lang>/quests.lua: T the title, O the
objectives, D the description -- the accept line. It is Wowhead's text word for word (134
quests compared) and has no progress or completion text. Its tokens are vmangos's already
($N, $B, $Gmale:female;).

The text goes into the dump's locales_quest *_locN columns, and the ordinary
`make web-import-locale` carries it into Postgres. A cell is written when it is empty or holds
English -- TDB's ptBR leaves both behind -- and never with pfQuest's own English, which it has
for a quest nobody translated. A translation already in the dump is otherwise kept, and
English that nothing replaces is cleared, since the import would carry it into Postgres as the
translation.

Local only, like the dump. Usage:
    python tools/fill_locales_from_pfquest.py --lang ptBR --pfquest ~/Downloads/pfQuest-wotlk --dry-run
    python tools/fill_locales_from_pfquest.py --lang ptBR --pfquest ~/Downloads/pfQuest-wotlk
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from fill_locales_from_tdb import untranslated  # noqa: E402

STEMS = {"T": "Title", "O": "Objectives", "D": "Details"}
# locales_quest column stem -> quest_template column with the English it translates. Wider
# than STEMS: English in any of them is cleared.
FIELDS = {
    "Title": "Title",
    "Objectives": "Objectives",
    "Details": "Details",
    "RequestItemsText": "RequestItemsText",
    "OfferRewardText": "OfferRewardText",
}

#------------------------------------------------------------------------------
# Reading pfQuest
#------------------------------------------------------------------------------

_STRING = r'"((?:[^"\\]|\\.)*)"'
_QUEST = re.compile(r'\[(\d+)\]\s*=\s*\{(.*?)\}\s*,', re.S)
_FIELD = re.compile(r'\["([A-Z])"\]\s*=\s*' + _STRING)
_ESCAPE = re.compile(r"\\(.)")


def read_quests(source: str) -> dict[int, dict[str, str]]:
    """quest id -> {locales_quest column stem: text} from a pfQuest quests.lua."""
    quests = {}
    for match in _QUEST.finditer(source):
        fields = {}
        for key, value in _FIELD.findall(match.group(2)):
            if key in STEMS:
                text = _ESCAPE.sub(lambda m: "\n" if m.group(1) == "n" else m.group(1), value)
                if text.strip():
                    fields[STEMS[key]] = text.strip()
        if fields:
            quests[int(match.group(1))] = fields
    return quests


def corpus_quest_ids() -> set[int]:
    from tts_cli.corpus import load_corpus
    return {line["questId"] for line in load_corpus()["lines"] if line.get("questId")}


#------------------------------------------------------------------------------
# Writing into vmangos
#------------------------------------------------------------------------------

def _english(text: str, theirs: set[str]) -> bool:
    """Whether a locale's text is really the English one -- by its words, or by being the
    English title itself, which is shorter than untranslated() will judge."""
    return any(untranslated(text, line) or text.strip().lower() == line.strip().lower()
               for line in theirs)


def plan(quests: dict[int, dict[str, str]], english: dict[int, dict[str, set[str]]],
         current: dict[int, dict[str, str | None]]) -> tuple[dict[int, dict[str, str | None]], Counter]:
    """Which cells to write: quest id -> {stem: text, or None to clear}, and what happened."""
    writes: dict[int, dict[str, str | None]] = defaultdict(dict)
    counts: Counter = Counter()
    for quest_id, fields in quests.items():
        for stem, text in fields.items():
            theirs = english.get(quest_id, {}).get(stem, set())
            if not any(theirs):
                counts[(stem, "no English line")] += 1
                continue
            if _english(text, theirs):
                counts[(stem, "source is English")] += 1
                continue
            cell = (current.get(quest_id, {}).get(stem) or "").strip()
            if cell == text:
                counts[(stem, "already there")] += 1
            elif cell and not _english(cell, theirs):
                counts[(stem, "dump has its own")] += 1
            else:
                writes[quest_id][stem] = text
                counts[(stem, "replaces English" if cell else "fills empty")] += 1
    for quest_id, cells in current.items():
        for stem, cell in cells.items():
            if (cell or "").strip() and stem not in writes.get(quest_id, {}) \
                    and _english(cell, english.get(quest_id, {}).get(stem, set())):
                writes[quest_id][stem] = None
                counts[(stem, "English cleared")] += 1
    return writes, counts


def write(lang: str, quests: dict[int, dict[str, str]], dry_run: bool) -> None:
    """The planned cells into the dump's locales_quest, with what happened printed."""
    from fill_locales_from_tdb import add_ptbr_columns
    from tts_cli.sql_queries import make_connection
    from tts_cli.utils import language_code_to_language_number

    column = language_code_to_language_number(lang)
    conn = make_connection()
    try:
        with conn.cursor() as cur:
            if lang == "ptBR" and not dry_run:
                add_ptbr_columns(cur)
            cur.execute(f"select entry, {', '.join(f'`{c}`' for c in FIELDS.values())} from quest_template")
            english: dict[int, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
            for row in cur.fetchall():
                for stem, text in zip(FIELDS, row[1:]):
                    english[int(row[0])][stem].add(text or "")
            cur.execute(f"select entry, {', '.join(f'`{s}_loc{column}`' for s in FIELDS)} from locales_quest")
            current = {int(row[0]): dict(zip(FIELDS, row[1:])) for row in cur.fetchall()}

            writes, counts = plan(quests, english, current)
            for (stem, outcome), n in sorted(counts.items()):
                print(f"  {stem:17} {outcome:22} {n:6}")
            if dry_run:
                return
            for quest_id, fields in writes.items():
                if quest_id not in current:
                    cur.execute("insert into locales_quest (entry) values (%s)", (quest_id,))
                assignments = ", ".join(f"`{stem}_loc{column}` = %s" for stem in fields)
                cur.execute(f"update locales_quest set {assignments} where entry = %s",
                            (*fields.values(), quest_id))
        conn.commit()
    finally:
        conn.close()
    print(f"wrote {sum(len(f) for f in writes.values())} cells over {len(writes)} quests")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lang", required=True)
    parser.add_argument("--pfquest", type=Path, required=True, help="an unpacked pfQuest release")
    parser.add_argument("--dry-run", action="store_true", help="count what would be written")
    args = parser.parse_args()

    source = (args.pfquest / "db" / args.lang / "quests.lua").read_text(encoding="utf-8")
    wanted = corpus_quest_ids()
    quests = {q: fields for q, fields in read_quests(source).items() if q in wanted}
    write(args.lang, quests, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
