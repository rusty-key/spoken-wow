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
    return [(row[9], row[1]) for row in _speaker_rows(cur) if row[9].startswith(f"q:{QUEST}:")]


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
    names = [(row[1], row[2]) for row in _speaker_rows(cur) if row[9] == f"q:{QUEST}:accept"]
    assert names == [(QUEST + 1, "English Name"), (QUEST + 2, "Test Speaker")]


def test_a_speaker_added_by_hand_carries_who_added_it(cur):
    line(cur, f"q:{QUEST}:accept")
    speaker(cur, f"q:{QUEST}:accept", "enUS", 0, 1)
    speaker(cur, f"q:{QUEST}:accept", "enUS", 1, 2)
    cur.execute("""update "quest_line_speaker" set "addedBy" = 'admin-1'
                    where "lineId" = %s and "npcId" = 2""", (f"q:{QUEST}:accept",))
    marks = [(row[1], row[8]) for row in _speaker_rows(cur) if row[9] == f"q:{QUEST}:accept"]
    assert marks == [(1, None), (2, "admin-1")]


def test_the_file_names_the_export_as_its_only_writer(cur, tmp_path):
    from tts_cli.corpus import load_corpus
    from tts_cli.corpus_db import export_corpus

    path = str(tmp_path / "corpus.json.gz")
    export_corpus(path, verbose=False)
    assert load_corpus(path)["producedBy"] == "export-corpus"


def npc_row(cur, npc_id):
    cur.execute("""insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance")
                   values ('creature', %s, 'human', 'male', 'official', 'corpus')""", (npc_id,))


def test_a_split_npcs_bodies_land_by_rank_and_a_corpus_body_the_file_drops_goes(cur):
    from tts_cli.corpus_db import _import_npc_bodies

    npc_id = QUEST
    npc_row(cur, npc_id)
    cur.execute("""insert into "npc_body" ("npcKind", "npcId", "race", "sex", "flavor", "provenance")
                   values ('creature', %s, 'human', 2, 'official', 'corpus'),
                          ('creature', %s, 'human', 3, 'warrior', 'moderator')""", (npc_id, npc_id))
    _import_npc_bodies(cur, [("creature", npc_id, "human", 3, None, "official", "corpus", False),
                             # No npc row: skipped, not an error.
                             ("creature", npc_id + 1, "human", 3, None, "official", "corpus", False)])
    cur.execute("""select "race", "sex", "gender", "flavor", "provenance" from "npc_body"
                    where "npcId" in (%s, %s) order by "sex" """, (npc_id, npc_id + 1))
    assert cur.fetchall() == [("human", 3, "female", "warrior", "moderator")]


def import_corpus_bodies(cur, bodies, **corpus):
    from tts_cli.corpus_db import _bodies_of, _import_npc_bodies, npc_body_answers
    file = {"npcs": [], **corpus} | bodies
    _import_npc_bodies(cur, npc_body_answers(_bodies_of(file), file["npcs"]))


def exported_bodies(cur, npc_id):
    from tts_cli.corpus_db import export_npc_bodies
    return [row for row in export_npc_bodies(cur) if row["npcId"] == npc_id]


def test_an_npc_of_two_races_of_one_sex_imports_and_exports_unchanged(cur):
    npc_id = QUEST + 2
    npc_row(cur, npc_id)
    bodies = [{"npcType": "creature", "npcId": npc_id, "race": race, "sex": 2, "gender": "male",
               "weight": 25.0, "flavor": "official", "provenance": "corpus"} for race in ("dwarf", "gnome")]
    import_corpus_bodies(cur, {"npcBodies": bodies})
    # The voice is the voice table's to name, and a test database has none.
    assert [{k: v for k, v in row.items() if k != "voice"} for row in exported_bodies(cur, npc_id)] == bodies
    assert [(row["race"], row["sex"], row["weight"]) for row in exported_bodies(cur, npc_id)] == [
        ("dwarf", 2, 25.0), ("gnome", 2, 25.0)]


def test_a_schema_5_files_sexes_import_as_bodies(cur):
    npc_id = QUEST + 3
    npc_row(cur, npc_id)
    sexes = [{"npcType": "creature", "npcId": npc_id, "sex": value, "race": "human",
              "gender": gender, "flavor": "official", "provenance": "corpus",
              "voice": f"human-{gender}-official"} for value, gender in ((2, "male"), (3, "female"))]
    import_corpus_bodies(cur, {"npcSexes": sexes})
    cur.execute("""select "race", "sex", "weight" from "npc_body" where "npcId" = %s order by "sex" """,
                (npc_id,))
    assert cur.fetchall() == [("human", 2, None), ("human", 3, None)]


def test_a_lone_body_is_no_split_and_is_not_exported(cur):
    npc_id = QUEST + 4
    npc_row(cur, npc_id)
    cur.execute("""insert into "npc_body" ("npcKind", "npcId", "race", "sex", "flavor", "provenance")
                   values ('creature', %s, 'human', 3, 'warrior', 'moderator')""", (npc_id,))
    assert exported_bodies(cur, npc_id) == []
