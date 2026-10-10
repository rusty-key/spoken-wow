"""Which speakers the export writes for a line (tts_cli/corpus_db.py _speaker_rows), the rule
the web catalogue's SPEAKERS reads lines by too."""
import os

import pytest

from tts_cli.corpus_db import _speaker_rows

QUEST = 987_654_321
ORD = 1_987_654_000


@pytest.fixture
def cur():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("needs DATABASE_URL and the web migrations")
    psycopg2 = pytest.importorskip("psycopg2")
    try:
        conn = psycopg2.connect(url)
    except psycopg2.OperationalError:
        pytest.skip("needs a reachable DATABASE_URL")
    with conn.cursor() as cur:
        cur.execute("""select to_regclass('"quest_line_speaker"')""")
        if cur.fetchone()[0] is None:
            pytest.skip("needs the web migrations")
        yield cur
    conn.rollback()
    conn.close()


def line(cur, line_id):
    cur.execute(
        """insert into "quest_line"
             ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
              "questTitle", "fileName", "text", "originalText", "generatable")
           values (%s, 0, 'enUS', 1, true, 'extracted', 'accept', %s, 'A Test Quest', %s,
                   'Bring me six wolf pelts.', 'Bring me six wolf pelts.', true)""",
        (line_id, QUEST, line_id))


def speaker(cur, line_id, lang, ord_, npc_id):
    cur.execute(
        """insert into "quest_line_speaker"
             ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
              "flavor", "voice")
           values (%s, 0, %s, %s, 'creature', %s, 'Test Speaker', 'human', 'male', 'warrior',
                   'human-male-warrior')""",
        (line_id, lang, ORD + ord_, npc_id))


def exported(cur):
    """This test's rows as (lineId, npcId), in the export's order."""
    return [(row[8], row[1]) for row in _speaker_rows(cur) if row[8].startswith(f"q:{QUEST}:")]


def test_a_line_english_speaks_has_english_speakers_alone(cur):
    line(cur, f"q:{QUEST}:accept")
    speaker(cur, f"q:{QUEST}:accept", "deDE", 0, 1)
    speaker(cur, f"q:{QUEST}:accept", "enUS", 1, 2)
    assert exported(cur) == [(f"q:{QUEST}:accept", 2)]


def test_a_line_only_other_languages_speak_has_each_npc_once_in_the_order_written(cur):
    line(cur, f"q:{QUEST}:accept")
    speaker(cur, f"q:{QUEST}:accept", "deDE", 0, 1)
    speaker(cur, f"q:{QUEST}:accept", "frFR", 1, 1)
    speaker(cur, f"q:{QUEST}:accept", "frFR", 2, 3)
    assert exported(cur) == [(f"q:{QUEST}:accept", 1), (f"q:{QUEST}:accept", 3)]


def test_lines_english_speaks_come_first(cur):
    line(cur, f"q:{QUEST}:accept")
    line(cur, f"q:{QUEST}:complete")
    speaker(cur, f"q:{QUEST}:accept", "deDE", 0, 1)
    speaker(cur, f"q:{QUEST}:complete", "enUS", 1, 2)
    assert exported(cur) == [(f"q:{QUEST}:complete", 2), (f"q:{QUEST}:accept", 1)]


def test_a_speaker_another_language_wrote_is_named_in_english_where_english_has_a_name(cur):
    line(cur, f"q:{QUEST}:accept")
    speaker(cur, f"q:{QUEST}:accept", "deDE", 0, QUEST + 1)
    speaker(cur, f"q:{QUEST}:accept", "deDE", 1, QUEST + 2)
    cur.execute("""insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
                   values ('creature', %s, 'enUS', 1, true, 'extracted', 'English Name')""",
                (str(QUEST + 1),))
    names = [(row[1], row[2]) for row in _speaker_rows(cur) if row[8] == f"q:{QUEST}:accept"]
    assert names == [(QUEST + 1, "English Name"), (QUEST + 2, "Test Speaker")]
