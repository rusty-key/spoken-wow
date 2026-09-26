import os
import re
import uuid

import pytest

from tts_cli.locale_import import (clean_localized, decide, extracted_lines, extracted_names,
                                   import_locale)
from tts_cli.utils import language_code_to_language_number

LOCALES_MJS = os.path.join(os.path.dirname(__file__), "..", "..", "lib", "locales.mjs")


def row(**overrides):
    base = {
        "quest": 33, "source": "accept", "player_gender": None, "type": "creature", "id": 197,
        "original_text": "Wolves are a menace, $N.", "templateText_race_gender_hash": "abc",
        "loc_text": None, "loc_title": None, "loc_name": None,
    }
    base.update(overrides)
    return base


class TestCleaning:
    def test_line_breaks_become_newlines(self):
        assert clean_localized("Hallo$B$BWelt", None) == "Hallo\n\nWelt"

    def test_a_direction_is_dropped_as_it_is_in_english(self):
        assert clean_localized("<Er seufzt.> Na gut.", None) == "Na gut."

    def test_gender_follows_the_english_line(self):
        text = "Willkommen, $GHerr:Dame;."
        assert clean_localized(text, "m") == "Willkommen, Herr."
        assert clean_localized(text, "f") == "Willkommen, Dame."
        # The English has no split, so there is no :f line for the female form to go to.
        assert clean_localized(text, None) == "Willkommen, Herr."

    def test_portuguese_writes_the_players_gender_as_u(self):
        assert clean_localized("Você foi $Uvitorioso:vitoriosa;!", "f") == "Você foi vitoriosa!"

    def test_the_player_name_is_left_for_a_translator(self):
        # The English cleaner writes "adventurer" here, which would be English in a German
        # sentence. Left in, it keeps the line from being voiced until someone rewrites it.
        assert clean_localized("Danke, $N.", None) == "Danke, $N."


class TestExtractedLines:
    def test_a_translated_line_is_anchored_to_the_english_one(self):
        [line] = extracted_lines([row(loc_text="Wölfe sind eine Plage.")])
        assert line["lineId"] == "q:33:accept"
        assert line["originalText"] == "Wolves are a menace, $N."
        assert line["text"] == "Wölfe sind eine Plage."
        assert line["localeText"] == "Wölfe sind eine Plage."
        assert line["generatable"] is True

    def test_an_untranslated_line_is_not_a_line(self):
        assert extracted_lines([row(loc_text=None), row(loc_text="")]) == []

    def test_speakers_sharing_a_line_are_one_line(self):
        lines = extracted_lines([row(id=197, loc_text="Ja."), row(id=198, loc_text="Ja.")])
        assert len(lines) == 1

    def test_a_player_name_makes_the_line_unvoiceable(self):
        [line] = extracted_lines([row(loc_text="Danke, $N.")])
        assert (line["generatable"], line["skipReason"]) == (False, "invalid-chars")

    def test_progress_text_is_voiced_in_every_language(self):
        [line] = extracted_lines([row(source="progress", loc_text="Noch nicht?")])
        assert (line["generatable"], line["skipReason"]) == (True, None)


class TestExtractedNames:
    def test_quest_titles_and_speaker_names(self):
        names = extracted_names([row(loc_title="Wölfe jenseits der Grenze", loc_name="Marschall")])
        assert names == {
            ("quest", "33"): "Wölfe jenseits der Grenze",
            ("creature", "197"): "Marschall",
        }

    def test_an_empty_column_names_nothing(self):
        assert extracted_names([row()]) == {}


class TestDecide:
    def test_new(self):
        assert decide(None, "x") == "promote"

    def test_unchanged(self):
        assert decide(("extracted", "x"), "x") == "skip"

    def test_changed_in_the_dump(self):
        assert decide(("extracted", "x"), "y") == "promote"

    def test_an_edit_is_never_overwritten(self):
        assert decide(("edited", "mine"), "the dump's") == "record"


def test_the_locale_columns_match_the_shared_language_list():
    """The dump's column numbers are stated twice: here, and in pipelines/lib/locales.mjs."""
    with open(LOCALES_MJS, encoding="utf-8") as f:
        source = f.read()
    listed = dict(re.findall(r'code: "(\w+)".*?vmangos: (\d+|null)', source))
    assert listed, "no locales found in locales.mjs"
    for code, number in listed.items():
        if number == "null":
            with pytest.raises(Exception):
                language_code_to_language_number(code)
        else:
            assert language_code_to_language_number(code) == int(number), code


def _database():
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    psycopg2 = pytest.importorskip("psycopg2")
    try:
        conn = psycopg2.connect(url)
        with conn.cursor() as cur:
            cur.execute("""select 1 from "quest_line" where "lang" = 'enUS' limit 1""")
            if cur.fetchone() is None:
                return None
            cur.execute("""select 1 from information_schema.columns
                            where table_name = 'quest_line' and column_name = 'localeText'""")
            if cur.fetchone() is None:
                return None
        return conn
    except psycopg2.OperationalError:
        return None


@pytest.fixture
def db():
    conn = _database()
    if conn is None:
        pytest.skip("needs DATABASE_URL, the web migrations and the corpus imported")
    # A language nothing else writes, cleared either side.
    yield conn
    with conn, conn.cursor() as cur:
        cur.execute("""delete from "quest_line" where "lang" = 'zhTW'""")
        cur.execute("""delete from "entity_name" where "lang" = 'zhTW'""")
    conn.close()


def _english_line(conn):
    with conn.cursor() as cur:
        cur.execute("""select "lineId", "originalText", "questId" from "quest_line"
                        where "lang" = 'enUS' and "isCurrent" and "questId" is not null
                        order by "lineId" limit 1""")
        return cur.fetchone()


def _live(conn, line_id):
    with conn.cursor() as cur:
        cur.execute("""select "text", "origin" from "quest_line"
                        where "lineId" = %s and "lang" = 'zhTW' and "isCurrent" """, (line_id,))
        return cur.fetchone()


def test_an_import_writes_lines_and_names_and_is_rerunnable(db):
    line_id, original, quest_id = _english_line(db)
    line = {"lineId": line_id, "originalText": original, "text": "你好", "localeText": "你好",
            "generatable": True, "skipReason": None}
    names = {("quest", str(quest_id)): "任務"}

    first = import_locale(db, "zhTW", [line], names)
    assert (first["lines promote"], first["names promote"]) == (1, 1)
    assert _live(db, line_id) == ("你好", "extracted")

    again = import_locale(db, "zhTW", [line], names)
    assert (again["lines skip"], again["names skip"]) == (1, 1)


def test_an_import_never_overwrites_an_edit(db):
    line_id, original, _ = _english_line(db)
    line = {"lineId": line_id, "originalText": original, "text": "你好", "localeText": "你好",
            "generatable": True, "skipReason": None}
    import_locale(db, "zhTW", [line], {})
    with db, db.cursor() as cur:
        cur.execute("""update "quest_line" set "origin" = 'edited', "text" = '改過'
                        where "lineId" = %s and "lang" = 'zhTW' and "isCurrent" """, (line_id,))

    counts = import_locale(db, "zhTW", [dict(line, text="新的")], {})
    assert counts["lines record"] == 1
    assert _live(db, line_id) == ("改過", "edited")


def test_a_line_the_corpus_does_not_carry_is_left_alone(db):
    stray = {"lineId": f"q:0:{uuid.uuid4().hex}", "originalText": "none", "text": "x",
             "localeText": "x", "generatable": True, "skipReason": None}
    counts = import_locale(db, "zhTW", [stray], {})
    assert counts["lines without an English line"] == 1
