"""
Import a QuestIT release -- the Italian community's quest translation -- into Postgres.

    python tools/import_questit.py ~/Downloads/QuestIT            # or: make quests-import-questit
    python tools/import_questit.py ~/Downloads/QuestIT --dry-run  # match and count, write nothing

Italian is a language no client runs in (pipelines/lib/locales.mjs), so the world database
has none of it and players send none. QuestIT is where its quest text comes from; this is
the feed, run again on each of their releases. tts_cli/questit.py says how a translation is
matched to its English line.

What it writes, all as origin 'community' with the release in `note`:

  * quest_line: accept, progress and complete text, and gossip, anchored to the English
    rows the way tts_cli/locale_import.py anchors a dump's translation, and through it;
  * entity_name: quest titles;
  * book_line: the few pages QuestIT has.

PRECEDENCE is every import's: unchanged text is skipped, a new release replaces what the
last one wrote, and a line somebody edited on the site keeps its edit -- the release's text
is recorded beside it, not made live.

`localeText` is left empty: it is what a client in the language shows, which is nothing.

Needs DATABASE_URL, like every import. Production as everything else reaches it:
    DATABASE_URL=$PROD_DATABASE_URL make quests-import-questit QUESTIT=~/Downloads/QuestIT
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tts_cli.corpus import _skip_reason  # noqa: E402
from tts_cli.locale_import import clean_localized, decide, import_locale, own_lines  # noqa: E402
from tts_cli.questit import (FIELDS, Hasher, load, match_by_hash, match_quest_line,  # noqa: E402
                             speak_npc_gender)

LANG = "itIT"


def english_lines(cur) -> list[tuple]:
    """Every live English quest and gossip line, with its first speaker's gender and voice."""
    cur.execute(
        """select q."lineId", q."source", q."questId", q."originalText", q."playerGender",
                  s."gender", s."voice"
             from "quest_line" q
             left join lateral (
                  select "gender", "voice" from "quest_line_speaker" s
                   where s."lineId" = q."lineId" and s."variant" = q."variant"
                     and s."lang" = q."lang"
                   order by s."ord" limit 1) s on true
            where q."lang" = 'enUS' and q."isCurrent"
              and q."source" = any(%s)
            order by q."lineId", q."variant" """,
        (list(FIELDS.values()) + ["gossip"],),
    )
    return cur.fetchall()


def translated_lines(data: dict, hasher: Hasher, rows: list[tuple]) -> tuple[list, Counter]:
    """The Italian for each English line QuestIT translates, in import_locale's shape."""
    counts = Counter()
    lines = []
    for line_id, source, quest_id, original, player_gender, npc_gender, voice in rows:
        if source == "gossip":
            italian = match_by_hash(hasher, data["gossip"], original, player_gender)
            outcome = "matched" if italian else "untranslated"
        else:
            entry = data["quests"].get(str(quest_id)) if quest_id is not None else None
            italian, outcome = match_quest_line(hasher, entry, source, original, player_gender)
        counts[f"{source} {outcome}"] += 1
        if italian is None:
            continue
        for own_id, _, text in own_lines(
                line_id, player_gender, italian,
                lambda gender: speak_npc_gender(clean_localized(italian, gender), npc_gender)):
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


def translated_titles(data: dict, hasher: Hasher, cur) -> tuple[dict, Counter]:
    """(kind, entityId) -> Italian title, where QuestIT's title is of our English one."""
    cur.execute(
        """select "entityId", "name" from "entity_name"
            where "kind" = 'quest' and "lang" = 'enUS' and "isCurrent" """
    )
    counts = Counter()
    names = {}
    for entity_id, english in cur.fetchall():
        entry = data["quests"].get(entity_id)
        italian, outcome = match_quest_line(hasher, {"text": entry["title"]} if entry and
                                            "title" in entry else None, "accept", english, None)
        counts[f"title {outcome}"] += 1
        if italian:
            names[("quest", entity_id)] = italian
    return names, counts


def import_pages(conn, data: dict, hasher: Hasher, note: str, dry_run: bool) -> Counter:
    """QuestIT's book pages -> book_line, structure from the English page."""
    counts = Counter()
    with conn, conn.cursor() as cur:
        cur.execute("""select "lineId", "text" from "book_line" where "lang" = 'enUS' and "isCurrent" """)
        pages = []
        for line_id, english in cur.fetchall():
            italian = match_by_hash(hasher, data["books"], english)
            if italian:
                pages.append((line_id, italian))
        cur.execute(
            """select "lineId", "origin", "text" from "book_line" where "lang" = %s and "isCurrent" """,
            (LANG,),
        )
        live = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
        for line_id, italian in pages:
            action = decide(live.get(line_id), italian)
            counts[f"pages {action}"] += 1
            if action == "skip" or dry_run:
                continue
            if action == "promote" and line_id in live:
                cur.execute(
                    """update "book_line" set "isCurrent" = false
                        where "lineId" = %s and "lang" = %s and "isCurrent" """,
                    (line_id, LANG),
                )
            cur.execute(
                """insert into "book_line"
                     ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
                      "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
                      "text", "generatable", "skipReason", "note")
                   select e."lineId", %s,
                          coalesce((select max(m."version") from "book_line" m
                                     where m."lineId" = e."lineId" and m."lang" = %s), 0) + 1,
                          %s, 'community', e."pageId", e."bookId", e."pageNumber", e."pageCount",
                          e."title", e."ownerKind", e."ownerIds", e."material", %s, true, null, %s
                     from "book_line" e
                    where e."lineId" = %s and e."lang" = 'enUS' and e."isCurrent" """,
                (LANG, LANG, action == "promote", italian, note, line_id),
            )
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("questit", help="a QuestIT release folder (QuestIT.toc, Data_it.lua, ...)")
    parser.add_argument("--dry-run", action="store_true", help="match and count, write nothing")
    args = parser.parse_args()

    from tts_cli.corpus_db import connect

    data = load(args.questit)
    note = f"QuestIT {data['version']}"
    hasher = Hasher(data["names"])
    print(f"{note}: {len(data['quests'])} quests, {len(data['gossip'])} gossip, "
          f"{len(data['books'])} pages", file=sys.stderr)

    conn = connect()
    try:
        with conn.cursor() as cur:
            lines, counts = translated_lines(data, hasher, english_lines(cur))
            names, title_counts = translated_titles(data, hasher, cur)
        counts += title_counts
        if not args.dry_run:
            counts += import_locale(conn, LANG, lines, names, origin="community", note=note)
        counts += import_pages(conn, data, hasher, note, args.dry_run)
    finally:
        conn.close()

    for key in sorted(counts):
        print(f"  {key}: {counts[key]}")
    if args.dry_run:
        print("dry run: nothing written")


if __name__ == "__main__":
    main()
