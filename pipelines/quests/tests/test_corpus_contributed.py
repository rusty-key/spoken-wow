"""Which of the corpus file's rows an import may write as the dump's, and which are contributions
the tables already hold (tts_cli/corpus_db.py, migration 0060)."""
from tts_cli.corpus_db import CONTRIBUTIONS_MARKED, removed_here, split_contributed


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


def added(line_id, npc_id, by="admin-1"):
    return {**row(line_id, npc_id), "addedBy": by}


def test_a_speaker_added_by_hand_this_database_holds_is_left_alone():
    lines = [row("q:1:accept", 10), added("q:1:accept", 11)]
    extracted, skipped = split_contributed(
        lines, CONTRIBUTIONS_MARKED, set(), set(), {("q:1:accept", "creature", 11)})
    assert extracted == [row("q:1:accept", 10)]
    assert skipped == 1


def test_a_speaker_added_by_hand_unknown_here_keeps_its_mark():
    # Written as an added speaker again, so the next extract import keeps it.
    lines = [row("q:1:accept", 10), added("q:1:accept", 11)]
    extracted, skipped = split_contributed(lines, CONTRIBUTIONS_MARKED, set(), set())
    assert extracted == lines
    assert skipped == 0


def test_a_speaker_removed_by_hand_is_left_out_on_every_side_of_its_moment():
    removed = {("q:1:accept", "creature", 10)}
    assert removed_here(row("q:1:accept", 10), removed)
    assert removed_here(row("q:1:accept:f", 10), removed)
    assert not removed_here(row("q:1:accept", 11), removed)
    assert not removed_here(row("q:1:complete", 10), removed)
    assert not removed_here({**row("q:1:accept", 10), "npcType": "gameobject"}, removed)


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


def body(npc_id, value, race, flavor, **extra):
    from tts_cli.npc_bodies import SEX_GENDER
    return {"npcType": "creature", "npcId": npc_id, "race": race, "sex": value,
            "gender": SEX_GENDER[value], "weight": None, "flavor": flavor, **extra}


def test_a_body_the_game_names_no_flavor_for_gets_its_race_genders_default_marked_doubtful():
    from tts_cli.corpus_db import npc_body_answers
    rows = npc_body_answers(
        [body(1, 2, "human", "official"), body(1, 3, "human", None),
         body(2, 3, "human", None, provenance="moderator")],
        [npc(1, "human", "male", "official"), npc(3, "human", "female", "standard")])
    assert rows == [
        ("creature", 1, "human", 2, None, "official", "corpus", False),
        ("creature", 1, "human", 3, None, "standard", "corpus", True),
        ("creature", 2, "human", 3, None, None, "moderator", False),
    ]


def test_a_moderators_answer_for_a_split_npc_is_its_own_bodys():
    from tts_cli.corpus_db import npc_body_answers
    rows = npc_body_answers(
        [body(1, 2, "human", "official"), body(1, 3, "human", "standard"),
         body(1, 2, "dwarf", "official", weight=25.0)],
        [dict(npc(1, "human", "male", "guard"), provenance="moderator", doubtful=True)])
    assert rows == [
        ("creature", 1, "human", 2, None, "guard", "moderator", True),
        ("creature", 1, "human", 3, None, "standard", "corpus", False),
        ("creature", 1, "dwarf", 2, 25.0, "official", "corpus", False),
    ]


def test_a_plain_line_the_site_split_by_player_gender_stays_split():
    from tts_cli.corpus_db import split_here
    variants = {"q:1:accept": ["a"], "q:2:accept": ["b"], "q:3:accept": ["c", "d"]}
    live = {("q:1:accept:m", 0): (), ("q:1:accept:f", 0): (), ("q:2:accept", 0): (),
            ("q:3:accept", 0): (), ("q:3:accept:f", 1): ()}
    assert split_here(variants, live) == {("q:1:accept", 0), ("q:3:accept", 1)}


def test_a_line_new_to_the_dump_is_not_taken_for_a_split():
    from tts_cli.corpus_db import split_here
    assert split_here({"q:1:accept": ["a"], "q:1:accept:m": ["b"]}, {}) == set()
