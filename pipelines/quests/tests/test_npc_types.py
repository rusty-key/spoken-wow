from tts_cli.npc_types import npc_types


def test_one_body_creature_gets_its_type():
    rows = [(100, 1, 0, 2, 1, "OrcFemaleStandardNPCGreetings")]
    assert npc_types(rows, set(), {}) == [
        {"npcId": 100, "race": "orc", "gender": "female", "sex": 3, "flavor": "standard"}]


def test_known_split_and_inhuman_creatures_are_left_alone():
    rows = [(1, 1, 0, 2, 1, None),                       # known already
            (2, 1, 50, 2, 0, None), (2, 2, 50, 1, 0, None),  # two bodies: npc_body's business
            (3, 1, 0, 99, 0, None)]                      # no humanoid race
    assert npc_types(rows, {1}, {}) == []


def test_no_sound_name_takes_the_race_gender_default():
    rows = [(100, 1, 0, 2, 0, None)]
    assert npc_types(rows, set(), {"orc-male": "standard"})[0]["flavor"] == "standard"


def test_the_heaviest_display_names_the_flavor():
    rows = [(100, 1, 30, 2, 0, "OrcMaleGuardNPCGreetings"),
            (100, 2, 70, 2, 0, "OrcMaleShadyNPCGreetings")]
    assert npc_types(rows, set(), {})[0]["flavor"] == "shady"
