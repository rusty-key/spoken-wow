"""The import's NPC answers against the npc table: a moderator's answer stays unless doubtful."""
import os

import pytest

from tts_cli.corpus_db import _import_npcs, _import_types, answered_models, with_answered_voices

NPC_ID = 987_654_321


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
        cur.execute("""select to_regclass('"npc"')""")
        if cur.fetchone()[0] is None:
            pytest.skip("needs the web migrations")
        # Every import here also deletes corpus rows the file lacks: rolled back below.
        yield cur
    conn.rollback()
    conn.close()


def answer(cur, npc_id):
    cur.execute("""select "race", "gender", "flavor", "provenance", "doubtful" from "npc"
                    where "npcKind" = 'creature' and "npcId" = %s""", (npc_id,))
    return cur.fetchone()


def seed(cur, npc_id, flavor, provenance, doubtful=False, race="human", gender="male"):
    cur.execute("""insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor",
                                      "provenance", "confirmed", "doubtful")
                   values ('creature', %s, %s, %s, %s, %s,
                           %s in ('corpus', 'display', 'moderator'), %s)""",
                (npc_id, race, gender, flavor, provenance, provenance, doubtful))


def test_a_moderators_answer_stays_and_is_reported(cur):
    seed(cur, NPC_ID, "warrior", "moderator")
    kept = _import_npcs(cur, [("creature", NPC_ID, "human", "male", "official", "moderator", False)])
    assert answer(cur, NPC_ID) == ("human", "male", "warrior", "moderator", False)
    assert kept == [("creature", NPC_ID, ("human", "male", "warrior", "moderator"),
                     ("human", "male", "official", "moderator"))]


def test_a_doubtful_moderators_answer_gives_way_to_the_file(cur):
    seed(cur, NPC_ID, "warrior", "moderator", doubtful=True)
    kept = _import_npcs(cur, [("creature", NPC_ID, "human", "male", "official", "corpus", False)])
    assert answer(cur, NPC_ID) == ("human", "male", "official", "corpus", False)
    assert kept == []


def test_the_extract_still_updates_its_own_answer(cur):
    seed(cur, NPC_ID, "warrior", "corpus")
    kept = _import_npcs(cur, [("creature", NPC_ID, "human", "male", "official", "corpus", False)])
    assert answer(cur, NPC_ID) == ("human", "male", "official", "corpus", False)
    assert kept == []


MODEL = ("creature", NPC_ID, "model-77", "male", None, "corpus", False)


@pytest.mark.parametrize("provenance", ["client", "display", "corpus"])
def test_a_model_from_the_dump_leaves_a_race_any_one_named(cur, provenance):
    # Bragok: a contribution heard a goblin; the dump knows only his model.
    seed(cur, NPC_ID, "zany", provenance, race="goblin")
    kept = _import_npcs(cur, [MODEL])
    assert answer(cur, NPC_ID) == ("goblin", "male", "zany", provenance, False)
    assert kept == [("creature", NPC_ID, ("goblin", "male", "zany", provenance),
                     ("model-77", "male", None, "corpus"))]


def test_a_model_from_the_dump_answers_an_npc_nobody_did(cur):
    seed(cur, NPC_ID, None, "none", race=None, gender=None)
    _import_npcs(cur, [MODEL])
    assert answer(cur, NPC_ID) == ("model-77", "male", None, "corpus", False)


def test_a_model_from_the_dump_updates_its_own_answer(cur):
    seed(cur, NPC_ID, None, "corpus", race="model-78")
    _import_npcs(cur, [MODEL])
    assert answer(cur, NPC_ID) == ("model-77", "male", None, "corpus", False)


def test_the_same_answer_is_not_reported(cur):
    seed(cur, NPC_ID, "warrior", "moderator")
    assert _import_npcs(cur, [("creature", NPC_ID, "human", "male", "warrior", "moderator", False)]) == []


def voice_for(cur, race, gender, flavor):
    cur.execute("""select voice_for(%s, %s, %s)""", (race, gender, flavor))
    return cur.fetchone()[0]


def test_a_type_the_site_lacks_is_added_with_the_voice_the_file_names(cur):
    _import_types(cur, [{"npcType": "creature", "npcId": NPC_ID, "race": "testtreant",
                         "gender": None, "flavor": None, "provenance": "moderator",
                         "voice": "testtreant"}])
    assert voice_for(cur, "testtreant", None, None) == "testtreant"


def test_a_seeded_voice_and_its_assignment_are_every_teams(cur):
    # The types are every team's, so each team's roster gets the voice: one row per team.
    cur.execute("""insert into "team" ("slug", "name") values ('test-corpus-npcs', 'Test')""")
    _import_types(cur, [{"npcType": "creature", "npcId": NPC_ID, "race": "testtreant",
                         "gender": None, "flavor": None, "provenance": "moderator",
                         "voice": "testtreant"}])
    cur.execute("""select (select count(*) from "team"),
                          (select count(*) from "voice" where "name" = 'testtreant'),
                          (select count(*) from "voice_assignment" a
                             join "voice" v on v."teamId" = a."teamId" and v."name" = a."voice"
                            where a."race" = 'testtreant')""")
    teams, voices, assignments = cur.fetchone()
    assert teams >= 2
    assert (voices, assignments) == (teams, teams)


def test_a_type_the_site_has_keeps_its_own_voice(cur):
    _import_types(cur, [{"npcType": "creature", "npcId": NPC_ID, "race": "human",
                         "gender": "male", "flavor": "standard", "provenance": "corpus",
                         "voice": "narrator-male"}])
    assert voice_for(cur, "human", "male", "standard") == "human-male-standard"


def test_a_model_slot_is_no_type(cur):
    _import_types(cur, [{"npcType": "creature", "npcId": NPC_ID, "race": "model-29",
                         "gender": "male", "flavor": None, "provenance": "corpus",
                         "voice": "model-29"}])
    cur.execute("""select 1 from "race" where "key" = 'model-29'""")
    assert cur.fetchone() is None


def test_a_flavorless_npc_of_a_known_race_gender_gives_it_no_bare_voice(cur):
    # The file's voice for it is its line's, made in some flavor: not one the race-gender has.
    _import_types(cur, [{"npcType": "creature", "npcId": NPC_ID, "race": "tauren",
                         "gender": "male", "flavor": None, "provenance": "corpus",
                         "voice": "tauren-male-warrior"}])
    assert voice_for(cur, "tauren", "male", None) is None


def test_a_flavor_the_site_lacks_is_added_with_its_voice(cur):
    _import_types(cur, [{"npcType": "creature", "npcId": NPC_ID, "race": "human",
                         "gender": "male", "flavor": "testflavor", "provenance": "moderator",
                         "voice": "human-male-testflavor"}])
    assert voice_for(cur, "human", "male", "testflavor") == "human-male-testflavor"


def dump_row(npc_id, text="Bring me six pelts.", source="accept", skip="no-voice", voice="model-77"):
    return {"lineId": "q:1:accept", "source": source, "npcType": "creature", "npcId": npc_id,
            "race": voice, "gender": "male", "flavor": None, "voice": voice, "text": text,
            "skipReason": skip, "generatable": skip is None}


def test_a_model_row_speaks_in_the_voice_its_npc_is_answered_with(cur):
    # Bragok: a contribution heard a goblin, and that line has takes in goblin-male-zany.
    seed(cur, NPC_ID, "zany", "client", race="goblin")
    [row] = with_answered_voices([dump_row(NPC_ID)], answered_models(cur, [dump_row(NPC_ID)]))
    assert (row["race"], row["gender"], row["flavor"]) == ("goblin", "male", "zany")
    assert row["voice"] == voice_for(cur, "goblin", "male", "zany")
    assert (row["skipReason"], row["generatable"]) == (None, True)


def test_an_answered_model_row_keeps_any_other_reason_not_to_voice_it(cur):
    seed(cur, NPC_ID, "zany", "client", race="goblin")
    rows = [dump_row(NPC_ID, text="Hello, $Q."), dump_row(NPC_ID, source="progress", skip="progress")]
    tokens, progress = with_answered_voices(rows, answered_models(cur, rows))
    assert (tokens["skipReason"], tokens["generatable"]) == ("invalid-chars", False)
    assert (progress["skipReason"], progress["generatable"]) == ("progress", False)


def test_a_model_row_nobody_answered_stays_a_model_slot(cur):
    seed(cur, NPC_ID, None, "none", race=None, gender=None)
    rows = [dump_row(NPC_ID), dump_row(NPC_ID + 1)]
    assert with_answered_voices(rows, answered_models(cur, rows)) == rows


def test_a_model_row_whose_npc_is_only_a_type_stays_a_model_slot(cur):
    seed(cur, NPC_ID, None, "client", race="creature", gender=None)
    rows = [dump_row(NPC_ID)]
    assert with_answered_voices(rows, answered_models(cur, rows)) == rows
