"""A language's quest text, from the world database straight into Postgres.

The English corpus goes dump -> corpus.json.gz -> import-corpus, because the committed file
is what an English pack is built from. A translation has no such file and gets none: it is
read out of the dump's *_locN columns and written to quest_line (the text) and entity_name
(quest titles and NPC names) under its language, the same tables the site edits it in.

WHAT A TRANSLATED LINE IS ANCHORED TO is the English line, never anything recomputed from
the translation. Line ids and file names derive from the English text (tts_cli/naming.py),
so the English query runs beside the locale's, and a translated line is written only where
an English line with that id and that original text exists. A line the dump translates but
the corpus does not carry -- an extract newer than the import, say -- is counted and left
alone; this never creates a line id.

THE TRANSLATION IS CLEANED THE WAY THE ENGLISH IS, WITH TWO EXCEPTIONS:

  * $G male:female; (ptBR's $U) is resolved by the ENGLISH row's player gender, because that is what
    splits the line id into :m and :f. A translation with a $G where the English has none
    takes the male form; one without where the English has one is the same text twice.
  * $N, $C and $R are left as they are. The English cleaner writes "adventurer" and
    "Traveler" in their place, which is English. The site speaks them as the language's own
    words when it judges and voices the line (apps/web/src/lib/player-words.ts), so the
    skipReason written here, which is this module's invalid-chars rule, is stricter than
    the site's: the site re-decides it from the text and does not read this one.

VARIANTS ARE AN ENGLISH MATTER. 103 line ids carry two English variants, because the dump
keeps a quest_template row per content patch; the addon's title lookup needs both English
titles on a vanilla client. A translation has one text per quest (locales_quest has no
patch) and every variant of a line shares one file, so a language keeps one row per line
id, variant 0, whichever English variant the dump row was anchored to. Writing one per
variant duplicated every translation, and where both variants have the same English it
wrote only one of them, leaving variant 0 untranslated and its file impossible to voice.

PRECEDENCE is import-corpus's: unchanged text is skipped, changed text is promoted unless
somebody edited the line here, in which case the dump's version is recorded but not made
live. Names follow the same rule in entity_name. Nothing is stored for a column the dump
leaves empty, and nothing is compared with the English: a German title that happens to be
spelled like the English one is still German.
"""
import re
import sys
from collections import Counter

from psycopg2.extras import execute_values

from tts_cli.corpus import _skip_reason
from tts_cli.naming import line_id_for_row

# ptBR writes the player's gender as $U where every other language writes $G.
_GENDER = re.compile(r"\$[GgUu]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*;")
_DIRECTION = re.compile(r"<.*?>\s")


def clean_localized(text: str, player_gender) -> str:
    """A translated line, cleaned as the English is except where that would be English."""
    cleaned = text.replace("$b", "\n").replace("$B", "\n")
    cleaned = _DIRECTION.sub("", cleaned)
    return _GENDER.sub(r"\2" if player_gender == "f" else r"\1", cleaned)


def extracted_lines(rows) -> list:
    """The translated lines in preprocessed rows, one per (lineId, originalText).

    `rows` are the English query's rows after TTSProcessor.preprocess_dataframe, carrying
    loc_text alongside. Several speakers share most lines; they are one line here.
    """
    seen = {}
    for row in rows:
        localized = row.get("loc_text")
        if not localized:
            continue
        key = (line_id_for_row(row), row["original_text"])
        if key in seen:
            continue
        text = clean_localized(localized, row.get("player_gender"))
        reason = _skip_reason({"source": row["source"], "cleanedText": text,
                               "voice_name": row.get("voice_name")})
        seen[key] = {
            "lineId": key[0],
            "originalText": key[1],
            "text": text,
            "localeText": localized,
            "generatable": reason is None,
            "skipReason": reason,
        }
    return list(seen.values())


def extracted_names(rows) -> dict:
    """(kind, entityId) -> the locale's name, for quests and for whoever speaks.

    First one wins where the dump is inconsistent with itself, which is the order the rows
    arrive in; the importer then keeps it for as long as it does not change.
    """
    names = {}
    for row in rows:
        if row.get("quest") and row.get("loc_title"):
            names.setdefault(("quest", str(int(row["quest"]))), row["loc_title"])
        if row.get("loc_name"):
            names.setdefault((row["type"], str(int(row["id"]))), row["loc_name"])
    return names


def decide(current, value) -> str:
    """What the import does with one line or name.

    `current` is (origin, value) for the live row, or None; `value` is what the dump says.
    'promote' writes a new live version, 'record' writes one that is not live (the line was
    edited here, and an import that could overwrite a correction is one nobody dares run),
    'skip' writes nothing.
    """
    if current is None:
        return "promote"
    origin, live = current
    if live == value:
        return "skip"
    return "record" if origin == "edited" else "promote"


# Rows per statement. Written a row at a time, an import through the ssh tunnel production is
# reached by (scripts/db/import-locale.sh) was twenty thousand round trips and minutes of a
# silent terminal; pipelines/lib/bulk.mjs is the Node half of the same fix.
BATCH = 500


def _write(cur, label: str, sql: str, rows: list, template: str | None = None) -> None:
    """execute_values in pages of BATCH, with a counter on stderr as it goes."""
    tty = sys.stderr.isatty()
    for start in range(0, len(rows), BATCH):
        page = rows[start:start + BATCH]
        execute_values(cur, sql, page, template=template, page_size=BATCH)
        done = start + len(page)
        print(f"\r  {label} {done}/{len(rows)}" if tty else f"  {label} {done}/{len(rows)}",
              end="" if tty else "\n", file=sys.stderr, flush=True)
    if tty and rows:
        print(file=sys.stderr)


def import_locale(conn, lang: str, lines: list, names: dict,
                  origin: str = "extracted", note: str | None = None) -> Counter:
    """Write a language's lines and names. Returns what happened, counted.

    `origin` is what the rows are: the dump's ('extracted'), or a translation community's
    ('community', tools/import_questit.py), with `note` saying which release. Either way an
    import replaces what it wrote before and only records beside what was edited here.
    """
    counts = Counter()
    with conn, conn.cursor() as cur:
        cur.execute(
            """select "lineId", "variant", "originalText", "source", "questId", "fileName",
                      "playerGender"
                 from "quest_line" where "lang" = 'enUS' and "isCurrent" """
        )
        english = {(r[0], r[2]): (r[1],) + r[3:] for r in cur.fetchall()}

        cur.execute(
            """select "lineId", "variant", "origin", "text", "localeText"
                 from "quest_line" where "lang" = %s and "isCurrent" """,
            (lang,),
        )
        live = {(r[0], r[1]): (r[2], (r[3], r[4])) for r in cur.fetchall()}
        cur.execute(
            """select "lineId", "variant", max("version") from "quest_line"
                where "lang" = %s group by 1, 2""",
            (lang,),
        )
        highest = {(r[0], r[1]): r[2] for r in cur.fetchall()}

        retire, insert, written = [], [], set()
        for line in lines:
            anchor = english.get((line["lineId"], line["originalText"]))
            if anchor is None:
                counts["lines without an English line"] += 1
                continue
            # One translation per line id, as variant 0, whichever English variant it was
            # read beside. See VARIANTS in the module docstring.
            if line["lineId"] in written:
                counts["lines on another variant"] += 1
                continue
            written.add(line["lineId"])
            _, source, quest_id, file_name, player_gender = anchor
            key = (line["lineId"], 0)
            variant = 0
            action = decide(live.get(key), (line["text"], line["localeText"]))
            counts[f"lines {action}"] += 1
            if action == "skip":
                continue
            # Only a line that has a live row has one to retire: on a first import that is none.
            if action == "promote" and key in live:
                retire.append(key)
            highest[key] = highest.get(key, 0) + 1
            insert.append((line["lineId"], variant, lang, highest[key], action == "promote",
                           origin, source, quest_id, player_gender, file_name, line["text"],
                           line["originalText"], line["localeText"], line["generatable"],
                           line["skipReason"], note))

        # Retired first, all of them: the one-live-row index would refuse an insert that
        # landed beside a row still current.
        _write(cur, "lines retired", """update "quest_line" as q set "isCurrent" = false
                 from (values %s) as r("lineId", "variant")
                where q."lineId" = r."lineId" and q."variant" = r."variant"
                  and q."lang" = """ + cur.mogrify("%s", (lang,)).decode() + """ and q."isCurrent" """,
               retire)
        _write(cur, "lines", """insert into "quest_line"
                 ("lineId", "variant", "lang", "version", "isCurrent", "origin",
                  "source", "questId", "playerGender", "fileName", "text",
                  "originalText", "localeText", "generatable", "skipReason", "note")
               values %s""", insert)

        cur.execute(
            """select "kind", "entityId", "origin", "name" from "entity_name"
                where "lang" = %s and "isCurrent" """,
            (lang,),
        )
        live_names = {(r[0], r[1]): (r[2], r[3]) for r in cur.fetchall()}
        cur.execute(
            """select "kind", "entityId", max("version") from "entity_name"
                where "lang" = %s group by 1, 2""",
            (lang,),
        )
        highest_names = {(r[0], r[1]): r[2] for r in cur.fetchall()}

        retire, insert = [], []
        for (kind, entity_id), name in names.items():
            key = (kind, entity_id)
            action = decide(live_names.get(key), name)
            counts[f"names {action}"] += 1
            if action == "skip":
                continue
            if action == "promote" and key in live_names:
                retire.append(key)
            highest_names[key] = highest_names.get(key, 0) + 1
            insert.append((kind, entity_id, lang, highest_names[key], action == "promote", origin,
                           name, note))

        _write(cur, "names retired", """update "entity_name" as e set "isCurrent" = false
                 from (values %s) as r("kind", "entityId")
                where e."kind" = r."kind" and e."entityId" = r."entityId"
                  and e."lang" = """ + cur.mogrify("%s", (lang,)).decode() + """ and e."isCurrent" """,
               retire)
        _write(cur, "names", """insert into "entity_name"
                 ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name", "note")
               values %s""", insert)
    return counts


def extract_and_import(lang: str) -> Counter:
    """The dump's `lang` columns -> Postgres. Needs MySQL and DATABASE_URL."""
    from tts_cli.corpus import extraction_rows
    from tts_cli.corpus_db import connect

    from tts_cli.sql_queries import (query_dataframe_for_all_quests_and_gossip,
                                     query_followup_dataframe)
    from tts_cli.tts_utils import TTSProcessor
    from tts_cli.utils import language_code_to_language_number

    print(f"  reading {lang} from the vmangos dump...", file=sys.stderr, flush=True)
    number = language_code_to_language_number(lang)
    # Follow-up and model-voiced rows too: a translation is anchored to its English row, and
    # without it would count as a line with no English line.
    df = extraction_rows(query_dataframe_for_all_quests_and_gossip(number, raw=True),
                         query_followup_dataframe(number, raw=True))
    rows = TTSProcessor.preprocess_dataframe(TTSProcessor.__new__(TTSProcessor), df)
    records = rows.to_dict("records")
    print("  reading what Postgres already has...", file=sys.stderr, flush=True)
    conn = connect()
    try:
        return import_locale(conn, lang, extracted_lines(records), extracted_names(records))
    finally:
        conn.close()
