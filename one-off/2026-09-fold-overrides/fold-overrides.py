#!/usr/bin/env python3
"""ONE-OFF, NOT YET RUN. See README.md here and ../README.md. Not maintained.

    DATABASE_URL=... pipelines/quests/.venv/bin/python one-off/2026-09-fold-overrides/fold-overrides.py

Needs psycopg2 (pipelines/quests/requirements-extract.txt) and nothing else from the repo.
"""
import os

import psycopg2

LANG = "enUS"


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set")
    return psycopg2.connect(url)


def fold_overrides():
    """line_override rows -> `edited` versions of the lines they rewrite.

    The override table was the corpus's missing half: "what this line should say instead",
    keyed by the audio file, with no history and no way to see what a line has been. Now
    that the corpus is versioned, an override IS a version -- so each row becomes one, with
    the person who wrote it recorded as its author, and the table stops being read.

    The override names a store path ('quests/5-accept.mp3'); a line names a bare filename
    ('5-accept') and a source. The subfolder is what distinguishes a gossip file from a
    quest one, which is the same rule subfolder_from_line_id encodes.
    """
    conn = connect()
    folded = skipped = missing = 0
    shared = 0
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""select "file", "text", "updatedBy" from "line_override" where "lang" = 'enUS' order by "file" """)
            overrides = cur.fetchall()

            for path_, text, updated_by in overrides:
                sub, _, leaf = path_.partition("/")
                name = leaf[:-4] if leaf.endswith(".mp3") else leaf
                gossip = sub == "gossip"

                cur.execute(
                    """select "lineId", "variant", "version", "text", "origin"
                         from "quest_line"
                        where "fileName" = %s and "lang" = %s and "isCurrent"
                          and (("source" = 'gossip') = %s)
                        order by "variant" """,
                    (name, LANG, gossip),
                )
                rows = cur.fetchall()

                if not rows:
                    # An override for a line the corpus no longer carries. Left in the
                    # table rather than dropped: it is a record that somebody rewrote
                    # something, and the extract is what moved underneath it.
                    missing += 1
                    continue
                if len(rows) > 1:
                    # One of the 103 files whose lineId names two different lines. Variant
                    # 0 is the one that is actually voiced -- the build takes the first
                    # line for a file -- so that is the one an override was written about.
                    shared += 1

                line_id, variant, version, current_text, _origin = rows[0]
                if current_text == text:
                    skipped += 1
                    continue

                # The next number after the highest, not after the live one: an import records
                # a new extract as a non-current version above an edited live one, and that
                # number is taken.
                cur.execute(
                    """select max("version") from "quest_line"
                        where "lineId" = %s and "variant" = %s and "lang" = %s""",
                    (line_id, variant, LANG),
                )
                (highest,) = cur.fetchone()

                cur.execute(
                    """update "quest_line" set "isCurrent" = false
                        where "lineId" = %s and "variant" = %s and "lang" = %s
                          and "isCurrent" """,
                    (line_id, variant, LANG),
                )
                cur.execute(
                    """insert into "quest_line"
                         ("lineId", "variant", "lang", "version", "isCurrent", "origin",
                          "source", "questId", "questTitle", "playerGender", "fileName",
                          "text", "originalText", "generatable", "skipReason",
                          "editedBy", "note")
                       select "lineId", "variant", "lang", %s, true, 'edited',
                              "source", "questId", "questTitle", "playerGender", "fileName",
                              %s, "originalText", "generatable", "skipReason",
                              %s, 'migrated from line_override'
                         from "quest_line"
                        where "lineId" = %s and "variant" = %s and "lang" = %s
                          and "version" = %s""",
                    (highest + 1, text, updated_by, line_id, variant, LANG, version),
                )
                folded += 1
    finally:
        conn.close()

    print(f"{len(overrides)} overrides: {folded} folded in, {skipped} already applied")
    if shared:
        print(f"{shared} were on a file whose id names two lines; applied to variant 0")
    if missing:
        print(f"{missing} name a line the corpus no longer has, and were left alone")


if __name__ == "__main__":
    fold_overrides()
