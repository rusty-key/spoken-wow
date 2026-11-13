"""
Import a Forever mission export -- a community's quest translation as CSV -- into Postgres.

    python tools/import_forever_csv.py ~/Downloads/forever-mission-viVN-….csv            # or: make quests-import-forever-csv
    python tools/import_forever_csv.py ~/Downloads/forever-mission-viVN-….csv --dry-run  # match and count, write nothing

Vietnamese is a language no client runs in (pipelines/lib/locales.mjs), so the world database
has none of it and players send none. This export is where its quest text comes from, run
again on each new one. tts_cli/forever_csv.py says how a translation is matched to its
English line. The export names its language, which must be one no client runs in.

What it writes, all as origin 'community' with the export in `note`:

  * quest_line: accept, progress and complete text, anchored to the English rows the way
    tts_cli/locale_import.py anchors a dump's translation, and through it;
  * entity_name: quest titles.

PRECEDENCE is every import's: unchanged text is skipped, a new export replaces what the
last one wrote, and a line somebody edited on the site keeps its edit -- the export's text
is recorded beside it, not made live.

Needs DATABASE_URL, like every import. Production as everything else reaches it:
    DATABASE_URL=$PROD_DATABASE_URL make quests-import-forever-csv CSV=~/Downloads/forever-mission-viVN-….csv
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tts_cli.corpus import _skip_reason  # noqa: E402
from tts_cli.forever_csv import SEGMENTS, load, match_quest_line, match_title  # noqa: E402
from tts_cli.locale_import import clean_localized, import_locale, own_lines  # noqa: E402

# Languages no client runs in that an export may write. Every other language has the
# world database and its players, whose text this would overwrite.
LANGS = {"viVN"}


def english_lines(cur) -> list[tuple]:
    """Every live English quest line, with its first speaker's voice."""
    cur.execute(
        """select q."lineId", q."source", q."questId", q."originalText", q."playerGender", s."voice"
             from "quest_line" q
             left join lateral (
                  select "voice" from "quest_line_speaker" s
                   where s."lineId" = q."lineId" and s."variant" = q."variant"
                     and s."lang" = q."lang"
                   order by s."ord" limit 1) s on true
            where q."lang" = 'enUS' and q."isCurrent"
              and q."source" = any(%s)
            order by q."lineId", q."variant" """,
        (list(SEGMENTS.values()),),
    )
    return cur.fetchall()


def translated_lines(data: dict, rows: list[tuple]) -> tuple[list, Counter]:
    """The translation of each English line the export has, in import_locale's shape."""
    counts = Counter()
    lines = []
    for line_id, source, quest_id, original, player_gender, voice in rows:
        entry = data["quests"].get(str(quest_id)) if quest_id is not None else None
        translated, outcome = match_quest_line(entry, source, original)
        counts[f"{source} {outcome}"] += 1
        if translated is None:
            continue
        for own_id, _, text in own_lines(line_id, player_gender, translated,
                                         lambda gender: clean_localized(translated, gender)):
            reason = _skip_reason({"source": source, "cleanedText": text, "voice_name": voice})
            lines.append({
                "lineId": own_id,
                "originalText": original,
                "text": text,
                "localeText": None,
                "generatable": reason is None,
                "skipReason": reason,
            })
    return lines, counts


def translated_titles(data: dict, cur) -> tuple[dict, Counter]:
    """(kind, entityId) -> translated title, where the export's title is of our English one."""
    cur.execute(
        """select "entityId", "name" from "entity_name"
            where "kind" = 'quest' and "lang" = 'enUS' and "isCurrent" """
    )
    counts = Counter()
    names = {}
    for entity_id, english in cur.fetchall():
        title = match_title(data["quests"].get(entity_id), english)
        counts["title " + ("matched" if title else "unmatched")] += 1
        if title:
            names[("quest", entity_id)] = title
    return names, counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("csv", help="a forever-mission-<lang>-<stamp>.csv export")
    parser.add_argument("--dry-run", action="store_true", help="match and count, write nothing")
    args = parser.parse_args()

    from tts_cli.corpus_db import connect

    data = load(args.csv)
    lang = data["language"]
    if lang not in LANGS:
        raise SystemExit(f"{lang}: not a language this import writes ({', '.join(sorted(LANGS))})")
    note = f"Forever export {lang} {data['stamp']}"
    print(f"{note}: {len(data['quests'])} quests", file=sys.stderr)

    conn = connect()
    try:
        with conn.cursor() as cur:
            lines, counts = translated_lines(data, english_lines(cur))
            names, title_counts = translated_titles(data, cur)
        counts += title_counts
        if not args.dry_run:
            counts += import_locale(conn, lang, lines, names, origin="community", note=note)
    finally:
        conn.close()

    for key in sorted(counts):
        print(f"  {key}: {counts[key]}")
    if args.dry_run:
        print("dry run: nothing written")


if __name__ == "__main__":
    main()
