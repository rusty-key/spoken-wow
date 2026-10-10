import os
import re
import uuid

import pytest

from tts_cli.locale_import import (clean_localized, decide, extracted_lines, extracted_names,
                                   import_locale, own_lines)
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


class TestOwnLines:
    def speak(self, gender):
        return f"said to {gender}"

    def test_a_g_splits_a_plain_english_line(self):
        assert own_lines("g:abc", None, "Hi $gm:f;", self.speak) == [
            ("g:abc:m", "m", "said to m"), ("g:abc:f", "f", "said to f")]

    def test_a_g_keeps_each_side_of_a_split_english_line(self):
        assert own_lines("g:abc:f", "f", "Hi $gm:f;", self.speak) == [("g:abc:f", "f", "said to f")]

    def test_no_g_is_one_line_read_beside_the_english_male_side(self):
        assert own_lines("g:abc:m", "m", "Hi", self.speak) == [("g:abc", None, "said to None")]
        assert own_lines("g:abc:f", "f", "Hi", self.speak) == []


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

    def test_a_translation_without_a_g_is_one_line_beside_the_english_male_one(self):
        rows = [row(player_gender="m", original_text="Hi, lad.", loc_text="Hallo."),
                row(player_gender="f", original_text="Hi, lass.", loc_text="Hallo.")]
        assert [(line["lineId"], line["originalText"]) for line in extracted_lines(rows)] == [
            ("q:33:accept", "Hi, lad.")]

    def test_a_translation_with_a_g_is_two_lines_where_the_english_is_one(self):
        lines = extracted_lines([row(loc_text="Willkommen, $GHerr:Dame;.")])
        assert [(line["lineId"], line["text"]) for line in lines] == [
            ("q:33:accept:m", "Willkommen, Herr."), ("q:33:accept:f", "Willkommen, Dame.")]

    def test_progress_text_is_never_voiced_in_any_language(self):
        [line] = extracted_lines([row(source="progress", loc_text="Noch nicht?")])
        assert line["skipReason"] == "progress"


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
    # zhTW may hold real text, so a test takes back only what it changed: the rows it wrote
    # go, and the rows it retired are live again.
    before = {}
    with conn, conn.cursor() as cur:
        for table in ("quest_line", "entity_name"):
            cur.execute(f"""select coalesce(max("id"), 0) from "{table}" """)
            highest = cur.fetchone()[0]
            cur.execute(f"""select "id" from "{table}" where "lang" = 'zhTW' and "isCurrent" """)
            before[table] = (highest, [r[0] for r in cur.fetchall()])
    yield conn
    with conn, conn.cursor() as cur:
        for table, (highest, live) in before.items():
            cur.execute(f"""delete from "{table}" where "lang" = 'zhTW' and "id" > %s""", (highest,))
            cur.execute(f"""update "{table}" set "isCurrent" = true
                             where "id" = any(%s) and not "isCurrent" """, (live,))
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


def _variants(conn, line_id):
    with conn.cursor() as cur:
        cur.execute("""select "variant", "originalText" from "quest_line"
                        where "lineId" = %s and "lang" = 'enUS' and "isCurrent"
                        order by "variant" """, (line_id,))
        return cur.fetchall()


def _translated_variants(conn, line_id):
    with conn.cursor() as cur:
        cur.execute("""select "variant", "text" from "quest_line"
                        where "lineId" = %s and "lang" = 'zhTW' and "isCurrent"
                        order by "variant" """, (line_id,))
        return cur.fetchall()


def _line(line_id, original, text="你好"):
    return {"lineId": line_id, "originalText": original, "text": text, "localeText": text,
            "generatable": True, "skipReason": None}


# Quest 4265 has a row per content patch, so the corpus carries two variants of each of its
# lines: the same English under two titles for complete, two different Englishes for accept.
def test_a_line_with_two_variants_of_one_english_text_is_translated_once(db):
    variants = _variants(db, "q:4265:complete")
    if len(variants) != 2 or variants[0][1] != variants[1][1]:
        pytest.skip("needs q:4265:complete as two variants of one English text")
    import_locale(db, "zhTW", [_line("q:4265:complete", variants[0][1])], {})
    assert _translated_variants(db, "q:4265:complete") == [(0, "你好")]


def test_a_line_with_two_variants_of_different_english_is_translated_once(db):
    variants = _variants(db, "q:4265:accept")
    if len(variants) != 2 or variants[0][1] == variants[1][1]:
        pytest.skip("needs q:4265:accept as two variants of different English texts")
    lines = [_line("q:4265:accept", original) for _, original in reversed(variants)]
    counts = import_locale(db, "zhTW", lines, {})
    assert _translated_variants(db, "q:4265:accept") == [(0, "你好")]
    assert counts["lines promote"] == 1

    again = import_locale(db, "zhTW", lines, {})
    assert again["lines promote"] == 0


def test_a_community_release_replaces_its_own_rows_and_keeps_an_edit(db):
    line_id, original, _ = _english_line(db)
    line = {"lineId": line_id, "originalText": original, "text": "一", "localeText": None,
            "generatable": True, "skipReason": None}
    import_locale(db, "zhTW", [line], {}, origin="community", note="QuestIT 1")
    assert _live(db, line_id) == ("一", "community")

    counts = import_locale(db, "zhTW", [dict(line, text="二")], {}, origin="community", note="QuestIT 2")
    assert counts["lines promote"] == 1
    assert _live(db, line_id) == ("二", "community")

    with db, db.cursor() as cur:
        cur.execute("""update "quest_line" set "origin" = 'edited', "text" = '改'
                        where "lineId" = %s and "lang" = 'zhTW' and "isCurrent" """, (line_id,))
    counts = import_locale(db, "zhTW", [dict(line, text="三")], {}, origin="community", note="QuestIT 3")
    assert counts["lines record"] == 1
    assert _live(db, line_id) == ("改", "edited")


def _english_by_player_gender(conn):
    with conn.cursor() as cur:
        cur.execute("""select m."lineId", m."originalText", f."originalText", m."fileName"
                         from "quest_line" m
                         join "quest_line" f on f."lineId" = left(m."lineId", -2) || ':f'
                          and f."lang" = 'enUS' and f."isCurrent" and f."variant" = 0
                        where m."lang" = 'enUS' and m."isCurrent" and m."variant" = 0
                          and m."lineId" like 'q:%%:m'
                        order by m."lineId" limit 1""")
        return cur.fetchone()


def _forms(conn, moment):
    with conn.cursor() as cur:
        cur.execute("""select "lineId", "playerGender", "fileName", "text" from "quest_line"
                        where "lineId" like %s and "lang" = 'zhTW' and "isCurrent"
                        order by "lineId" """, (moment + "%",))
        return cur.fetchall()


def test_a_translation_is_one_line_where_its_english_is_two(db):
    found = _english_by_player_gender(db)
    if found is None:
        pytest.skip("needs an English line split by player gender")
    male_id, male_original, _, male_file = found
    moment = male_id[:-2]
    import_locale(db, "zhTW", [_line(moment, male_original)], {})
    assert _forms(db, moment) == [(moment, None, male_file[2:], "你好")]


def test_a_new_shape_retires_the_old_unless_it_was_edited_here(db):
    found = _english_by_player_gender(db)
    if found is None:
        pytest.skip("needs an English line split by player gender")
    male_id, male_original, female_original, _ = found
    moment = male_id[:-2]
    import_locale(db, "zhTW", [_line(male_id, male_original), _line(f"{moment}:f", female_original)], {})
    counts = import_locale(db, "zhTW", [_line(moment, male_original)], {})
    assert counts["lines of another shape retired"] == 2
    assert [row[0] for row in _forms(db, moment)] == [moment]

    with db, db.cursor() as cur:
        cur.execute("""update "quest_line" set "origin" = 'edited'
                        where "lineId" = %s and "lang" = 'zhTW' and "isCurrent" """, (moment,))
    counts = import_locale(db, "zhTW", [_line(male_id, male_original), _line(f"{moment}:f", female_original)], {})
    assert counts["moments kept as edited here"] == 1
    assert [row[0] for row in _forms(db, moment)] == [moment]
