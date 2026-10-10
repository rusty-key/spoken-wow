"""Which of the corpus file's rows an import may write as the dump's, and which are contributions
the tables already hold (tts_cli/corpus_db.py, migration 0060)."""
from tts_cli.corpus_db import CONTRIBUTIONS_MARKED, split_contributed


def row(line_id, npc_id, contribution=None):
    r = {"lineId": line_id, "npcType": "creature", "npcId": npc_id, "npcName": f"NPC {npc_id}",
         "race": "human", "gender": "male", "flavor": None, "voice": "human-male"}
    if contribution is not None:
        r["contributionId"] = contribution
    return r


def speaker_key(r):
    return (r["lineId"], r["npcType"], r["npcId"], r["npcName"], r["race"], r["gender"],
            r["flavor"], r["voice"])


def test_a_marked_contribution_this_database_holds_is_left_alone():
    lines = [row("q:1:accept", 10), row("q:2:accept", 20, contribution=5)]
    extracted, skipped = split_contributed(lines, CONTRIBUTIONS_MARKED, {5}, set())
    assert extracted == [row("q:1:accept", 10)]
    assert skipped == 1


def test_a_marked_contribution_unknown_here_is_seeded_as_a_plain_row():
    # A fresh database seeded from the committed export, as CI's is, has no contribution rows.
    lines = [row("q:2:accept", 20, contribution=5)]
    extracted, skipped = split_contributed(lines, CONTRIBUTIONS_MARKED, set(), set())
    assert extracted == [row("q:2:accept", 20)]
    assert skipped == 0


def test_in_a_marked_file_an_unmarked_row_is_the_dumps_even_when_it_matches_a_contribution():
    # The dump has found the contributed NPC on its line, and is the source of truth now.
    lines = [row("q:2:accept", 20)]
    extracted, skipped = split_contributed(
        lines, CONTRIBUTIONS_MARKED, {5}, {speaker_key(row("q:2:accept", 20))})
    assert extracted == lines
    assert skipped == 0


def test_an_older_file_skips_the_round_tripped_copy_of_a_contributed_speaker():
    lines = [row("q:1:accept", 10), row("q:2:accept", 20)]
    extracted, skipped = split_contributed(
        lines, CONTRIBUTIONS_MARKED - 1, set(), {speaker_key(row("q:2:accept", 20))})
    assert extracted == [row("q:1:accept", 10)]
    assert skipped == 1


def npc(npc_id, race, gender, flavor, npc_type="creature"):
    return {"npcType": npc_type, "npcId": npc_id, "race": race, "gender": gender, "flavor": flavor}


def test_an_npc_the_game_names_no_flavor_for_gets_its_race_genders_default_marked_doubtful():
    from tts_cli.corpus_db import npc_answers
    rows = npc_answers([npc(1, "human", "male", "standard"), npc(2, "human", "male", "official"),
                        npc(3, "human", "male", None), npc(4, "tauren", "male", "warrior"),
                        npc(5, "tauren", "male", None), npc(6, "narrator", "male", None, "gameobject")])
    assert rows == [
        ("creature", 1, "human", "male", "standard", "corpus", False),
        ("creature", 2, "human", "male", "official", "corpus", False),
        ("creature", 3, "human", "male", "standard", "corpus", True),
        ("creature", 4, "tauren", "male", "warrior", "corpus", False),
        # No standard voice for the race-gender: its busiest.
        ("creature", 5, "tauren", "male", "warrior", "corpus", True),
        # An older file's narrated gameobject is a gameobject, with no gender and no flavor.
        ("gameobject", 6, "gameobject", None, None, "corpus", False),
    ]


def test_only_the_extracts_own_flavorless_answer_gets_the_default():
    from tts_cli.corpus_db import npc_answers
    rows = npc_answers([npc(1, "human", "male", "standard"),
                        dict(npc(2, "human", "male", None), provenance="moderator")])
    assert rows[1] == ("creature", 2, "human", "male", None, "moderator", False)
