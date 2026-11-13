"""Which NPCs are split by body, who each body is, and the body each sex falls back to
(tts_cli/npc_bodies.py)."""
from tts_cli.npc_bodies import npc_bodies, sex_bodies


def npc(npc_id, race="human", gender="male", npc_type="creature"):
    return {"npcType": npc_type, "npcId": npc_id, "race": race, "gender": gender, "flavor": None}


def answers(rows):
    return [(row["npcId"], row["race"], row["sex"], row["weight"], row["flavor"], row["voice"])
            for row in rows]


def test_a_guard_drawn_as_both_sexes_is_two_bodies_of_one_race():
    displays = [(68, 1, 50, 1, 0, "HumanMaleOfficialNPCGreetings"),
                (68, 2, 50, 1, 1, "HumanFemaleOfficialNPCGreetings")]
    assert answers(npc_bodies(displays, [npc(68)])) == [
        (68, "human", 2, 50, "official", "human-male-official"),
        (68, "human", 3, 50, "official", "human-female-official"),
    ]


def test_the_ironforge_reveler_is_four_bodies():
    displays = [(15906, 1, 25, 3, 0, "DwarfMaleStandardNPCGreetings"),
                (15906, 2, 25, 3, 1, "DwarfFemaleStandardNPCGreetings"),
                (15906, 3, 25, 7, 0, "GnomeMaleStandardNPCGreetings"),
                (15906, 4, 25, 7, 1, "GnomeFemaleStandardNPCGreetings")]
    assert [(row["race"], row["sex"]) for row in npc_bodies(displays, [npc(15906, race="dwarf")])] == [
        ("dwarf", 2), ("gnome", 2), ("dwarf", 3), ("gnome", 3)]


def test_two_races_of_one_sex_split_ribblys_crony():
    displays = [(10043, 1, 25, 6, 0, None), (10043, 2, 25, 6, 0, None),
                (10043, 3, 25, 8, 0, None), (10043, 4, 25, 8, 0, None)]
    assert [(row["race"], row["sex"], row["weight"]) for row in
            npc_bodies(displays, [npc(10043, race="tauren")])] == [("tauren", 2, 50), ("troll", 2, 50)]


def test_one_body_is_not_split():
    displays = [(1, 1, 50, 1, 0, "HumanMaleOfficialNPCGreetings"),
                (1, 2, 50, 1, 0, "HumanMaleWarriorNPCGreetings")]
    assert npc_bodies(displays, [npc(1)]) == []


def test_a_body_takes_the_flavor_its_displays_name_most():
    displays = [(2, 1, 20, 4, 1, "NightElfFemalePriestessNPCGreeti"),
                (2, 2, 15, 4, 1, "NightElfFemaleStandardNPCGreeti"),
                (2, 3, 30, 1, 0, "HumanMaleStandardNPCGreetings")]
    rows = {(row["race"], row["sex"]): row for row in npc_bodies(displays, [npc(2)])}
    assert rows[("nightelf", 3)]["flavor"] == "priestess"
    assert rows[("nightelf", 3)]["weight"] == 35


def test_even_odds_are_what_vmangos_leaves_as_no_probability_at_all():
    displays = [(3, 1, 0, 1, 1, "HumanFemaleStandardNPCGreetings"), (3, 2, 0, 1, 0, None)]
    assert answers(npc_bodies(displays, [npc(3)])) == [
        (3, "human", 2, 1, None, "human-male"),
        (3, "human", 3, 1, "standard", "human-female-standard"),
    ]


def test_only_a_creature_with_a_humanoid_answer_is_split():
    displays = [(4, 1, 1, 1, 0, None), (4, 2, 1, 1, 1, None)]
    assert npc_bodies(displays, [npc(4, race="model-29", gender=None),
                                 npc(4, race="gameobject", gender=None, npc_type="gameobject")]) == []


def body(race, sex, weight=None):
    return {"race": race, "sex": sex, "weight": weight}


def test_a_sex_falls_back_to_its_body_of_the_npcs_race():
    bodies = [body("gnome", 2, 30), body("dwarf", 2, 20), body("gnome", 3, 25)]
    chosen = sex_bodies(bodies, "dwarf")
    assert (chosen[2]["race"], chosen[3]["race"]) == ("dwarf", "gnome")


def test_without_the_npcs_race_a_sex_takes_its_heaviest_body_then_the_first():
    assert sex_bodies([body("gnome", 2, None), body("troll", 2, 5)], "human")[2]["race"] == "troll"
    assert sex_bodies([body("gnome", 2), body("troll", 2)], "human")[2]["race"] == "gnome"


def test_a_sex_with_no_body_is_absent():
    assert set(sex_bodies([body("dwarf", 2), body("gnome", 2)], "dwarf")) == {2}
