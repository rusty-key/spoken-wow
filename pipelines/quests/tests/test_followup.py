from tts_cli.followup import (GENERIC_SCRIPTS, corpus_rows, creature_voices, number_steps,
                              script_lines, speaker_entries)


def _line(broadcast, speakers, male="Well done.", female=None, delay=0):
    return {"id": broadcast, "speaker": speakers[0] if len(speakers) == 1 else None,
            "speakers": speakers, "delay": delay, "chat": "say",
            "male": male, "female": female or male}


def _voice(name, race=3, sex=0, sound="DwarfMaleStandardNPCGreetings"):
    return {"name": name, "DisplayRaceID": race, "DisplaySexID": sex, "npc_sound_name": sound}


CREATURES = {
    1: [_voice("Belgrum")],
    2: [_voice("Mountaineer", sound="DwarfMaleGrimNPCGreetings")],
    3: [_voice("Sister", race=1, sex=1, sound="HumanFemaleStandardNPCGreetings")],
}


def test_a_quest_with_several_enders_is_voiced_in_each():
    # The addon's export leaves `speaker` unset for these; the corpus cannot, since a line
    # nobody speaks is never recorded.
    result = {"end": {10: ("Two Enders", [_line(500, [1, 2])])}}

    rows = corpus_rows(result, CREATURES)

    assert [(r["id"], r["name"]) for r in rows] == [(1, "Belgrum"), (2, "Mountaineer")]
    assert {r["source"] for r in rows} == {"followup"}
    assert {r["broadcast_text_id"] for r in rows} == {500}
    assert {r["quest"] for r in rows} == {10}


def test_a_line_shared_by_two_quests_is_a_row_under_each():
    # factions.pack_of_line reads the quest, so both sides have to see the line.
    result = {"end": {10: ("A", [_line(500, [1])]), 11: ("B", [_line(500, [1])])}}

    assert [r["quest"] for r in corpus_rows(result, CREATURES)] == [10, 11]


def test_the_speakers_sex_picks_the_text():
    result = {"end": {10: ("A", [_line(500, [1, 3], male="Thanks, lad.",
                                       female="Thanks, dear.")])}}

    texts = {r["name"]: (r["text"], r["original_text"]) for r in corpus_rows(result, CREATURES)}

    assert texts == {"Belgrum": ("Thanks, lad.", "Thanks, lad."),
                     "Sister": ("Thanks, dear.", "Thanks, dear.")}


def test_a_speaker_with_no_voice_facts_is_left_out():
    # Not in the voice facts at all: its display is missing from the dump, so there is not
    # even a model to voice it by.
    result = {"end": {10: ("A", [_line(500, [99]), _line(501, [])])}}

    assert corpus_rows(result, CREATURES) == []


def test_the_same_words_twice_for_one_quest_are_one_row():
    # A quest's start and end scripts can say the same thing, and so can two alternatives.
    result = {"end": {10: ("A", [_line(500, [1]), _line(500, [1], delay=3)])},
              "start": {10: ("A", [_line(500, [1])])}}

    assert len(corpus_rows(result, CREATURES)) == 1


def test_speaker_entries_is_every_candidate():
    result = {"end": {10: ("A", [_line(500, [1, 2])])}, "start": {11: ("B", [_line(7, [3])])}}

    assert speaker_entries(result) == {1, 2, 3}


# script_lines: quest scripts that hand off to generic_scripts with START_SCRIPT (command 39).

def _talk(script, broadcast, delay=0, target_type=0, param1=0, flags=0, alternatives=(),
          chat=0):
    extra = list(alternatives) + [0, 0, 0]
    return {"id": script, "delay": delay, "datalong": chat, "target_type": target_type,
            "target_param1": param1, "data_flags": flags, "dataint": broadcast,
            "dataint2": extra[0], "dataint3": extra[1], "dataint4": extra[2]}


def _start(script, *chosen, delay=0, target_type=0, param1=0, flags=0):
    """A START_SCRIPT row; `chosen` is (generic script, chance) pairs."""
    chosen = list(chosen) + [(0, 0)] * (4 - len(chosen))
    row = {"id": script, "delay": delay, "target_type": target_type,
           "target_param1": param1, "data_flags": flags}
    for n, (generic, chance) in enumerate(chosen):
        suffix = "" if n == 0 else str(n + 1)
        row["datalong" + suffix], row["dataint" + suffix] = generic, chance
    return row


def _scripts(quest_talk=(), quest_starts=(), generic_talk=(), generic_starts=()):
    def by_id(rows):
        out = {}
        for row in rows:
            out.setdefault(row["id"], []).append(row)
        return out
    return {"quest_end_scripts": (by_id(quest_talk), by_id(quest_starts)),
            GENERIC_SCRIPTS: (by_id(generic_talk), by_id(generic_starts))}


# (male, female, broadcast_text.chat_type): say unless a test says otherwise.
TEXTS = {n: (f"Line {n}.", "", 0) for n in range(1, 20)}
TEXTS[9] = ("%s begins a rite.", "", 2)
TEXTS[13] = ("Line 13.", "", 1)      # a yell
TEXTS[14] = ("Line 14.", "", 6)      # a zone yell
TEXTS[15] = ("Line 15.", "", 4)      # a whisper
TEXTS[16] = ("Smashes the claw.", "", 2)   # an emote written without its %s


def _lines(scripts, source=1, candidates=(1,), guids=None):
    """What collect keeps for one quest: its lines in order, steps numbered."""
    lines = script_lines("quest_end_scripts", 100, source, list(candidates), scripts, TEXTS,
                         guids or {}, {})
    lines.sort(key=lambda line: (line["delay"], line["id"]))
    return number_steps(lines)


def test_a_chained_line_waits_for_the_hand_off_and_then_its_own_delay():
    # To Serve Kum'isha: a 1 s hand-off, then lines 132 s into the generic script.
    scripts = _scripts(quest_starts=[_start(100, (7, 100), delay=1)],
                       generic_talk=[_talk(7, 1, delay=132), _talk(7, 2, delay=147)])

    assert [(line["id"], line["delay"]) for line in _lines(scripts)] == [(1, 133), (2, 148)]


def test_the_chained_script_is_run_by_the_quest_ender():
    # For The Horde!: Thrall ends the quest, hands off with no target, and speaks himself.
    scripts = _scripts(quest_starts=[_start(100, (7, 100))], generic_talk=[_talk(7, 1)])

    [line] = _lines(scripts, source=4949, candidates=[4949])

    assert (line["speaker"], line["speakers"]) == (4949, [4949])


def test_a_hand_off_that_swaps_in_a_creature_makes_it_the_chained_scripts_speaker():
    # Scarlet Subterfuge: each hand-off names a Scarlet Cavalier by spawn guid and swaps it in
    # as the source, and the generic script's own rows have no target of their own.
    scripts = _scripts(quest_starts=[_start(100, (48190, 100), target_type=11, param1=48190,
                                            flags=0x02)],
                       generic_talk=[_talk(48190, 1)])

    [line] = _lines(scripts, source=1842, candidates=[1842], guids={48190: 1836})

    assert (line["speaker"], line["speakers"]) == (1836, [1836])


def test_a_hand_off_to_a_creature_it_does_not_swap_in_leaves_the_ender_speaking():
    scripts = _scripts(quest_starts=[_start(100, (7, 100), target_type=10, param1=55)],
                       generic_talk=[_talk(7, 1)])

    [line] = _lines(scripts, source=1842, candidates=[1842])

    assert line["speaker"] == 1842


def test_several_enders_stay_unresolved_through_the_hand_off():
    # As for the quest script's own lines: the addon gets no speaker, the corpus every ender.
    scripts = _scripts(quest_starts=[_start(100, (7, 100))], generic_talk=[_talk(7, 1)])

    [line] = _lines(scripts, source=None, candidates=[1, 2])

    assert (line["speaker"], line["speakers"]) == (None, [1, 2])


def test_a_chained_row_can_still_name_its_own_speaker():
    scripts = _scripts(quest_starts=[_start(100, (7, 100))],
                       generic_talk=[_talk(7, 1, target_type=10, param1=10804, flags=0x02)])

    [line] = _lines(scripts)

    assert (line["speaker"], line["speakers"]) == (10804, [10804])


def test_the_scripts_one_hand_off_chooses_between_are_each_listed():
    # The server rolls for one; which, the addon learns only when it is said. A zero chance
    # is never rolled.
    scripts = _scripts(quest_starts=[_start(100, (7, 50), (8, 50), (9, 0), delay=2)],
                       generic_talk=[_talk(7, 1, delay=3), _talk(8, 2, delay=3),
                                     _talk(9, 3, delay=3)])

    assert sorted((line["id"], line["delay"]) for line in _lines(scripts)) == [(1, 5), (2, 5)]


def test_chained_emotes_and_random_texts_follow_the_usual_rules():
    scripts = _scripts(quest_starts=[_start(100, (7, 100))],
                       generic_talk=[_talk(7, 9), _talk(7, 1, alternatives=(2,))])

    assert sorted(line["id"] for line in _lines(scripts)) == [1, 2]


def test_a_generic_script_handing_off_again_is_followed():
    scripts = _scripts(quest_starts=[_start(100, (7, 100), delay=1)],
                       generic_starts=[_start(7, (8, 100), delay=2)],
                       generic_talk=[_talk(8, 1, delay=3)])

    assert [(line["id"], line["delay"]) for line in _lines(scripts)] == [(1, 6)]


def test_a_chain_that_loops_back_is_walked_once():
    scripts = _scripts(quest_starts=[_start(100, (7, 100))],
                       generic_starts=[_start(7, (8, 100)), _start(8, (7, 100))],
                       generic_talk=[_talk(7, 1), _talk(8, 2)])

    assert sorted(line["id"] for line in _lines(scripts)) == [1, 2]


def test_a_script_handing_off_to_itself_says_its_lines_once():
    scripts = _scripts(quest_starts=[_start(100, (7, 100))],
                       generic_starts=[_start(7, (7, 100))], generic_talk=[_talk(7, 1)])

    assert [line["id"] for line in _lines(scripts)] == [1]


# The chat type a line is heard in.

def test_a_row_with_no_chat_type_of_its_own_says_its_text_in_the_texts():
    scripts = _scripts(quest_talk=[_talk(100, 1), _talk(100, 13), _talk(100, 14),
                                   _talk(100, 15)])

    assert [(line["id"], line["chat"]) for line in _lines(scripts)] == \
        [(1, "say"), (13, "yell"), (14, "yell"), (15, "whisper")]


def test_a_rows_own_chat_type_overrides_the_texts():
    # 7496 Celebrating Good Times: datalong 6 on a text written as a yell.
    scripts = _scripts(quest_talk=[_talk(100, 13, chat=6), _talk(100, 1, chat=1)])

    assert [(line["id"], line["chat"]) for line in _lines(scripts)] == [(1, "yell"), (13, "yell")]


def test_emotes_are_left_out_whatever_their_text_looks_like():
    scripts = _scripts(quest_talk=[_talk(100, 16), _talk(100, 1, chat=2), _talk(100, 2),
                                   _talk(100, 3, chat=5)])

    assert [(line["id"], line["chat"]) for line in _lines(scripts)] == \
        [(2, "say"), (3, "whisper")]


# Steps: which lines are outcomes of one script step.

def test_each_row_is_a_step_and_its_random_texts_share_it():
    scripts = _scripts(quest_talk=[_talk(100, 1, alternatives=(2, 3)), _talk(100, 4, delay=5)])

    assert [(line["id"], line["step"]) for line in _lines(scripts)] == \
        [(1, 1), (2, 1), (3, 1), (4, 2)]


def test_one_speakers_lines_at_one_second_are_separate_steps_when_separate_rows():
    # Scarlet Subterfuge: four hand-offs, each to one Cavalier's own script, all at 0 s and
    # all the same creature entry. Each line is said; none stands in for another.
    guids = {48190: 1836, 48188: 1836}
    scripts = _scripts(quest_starts=[_start(100, (48190, 100), target_type=11, param1=48190,
                                            flags=0x02),
                                     _start(100, (48188, 100), target_type=11, param1=48188,
                                            flags=0x02)],
                       generic_talk=[_talk(48190, 1), _talk(48188, 2), _talk(48188, 3, delay=6)])

    lines = _lines(scripts, source=1842, candidates=[1842], guids=guids)

    assert [(line["id"], line["speaker"], line["step"]) for line in lines] == \
        [(1, 1836, 1), (2, 1836, 2), (3, 1836, 3)]


def test_two_hand_offs_into_one_script_are_two_runs_of_it():
    scripts = _scripts(quest_starts=[_start(100, (7, 100)), _start(100, (7, 100), delay=1)],
                       generic_talk=[_talk(7, 1)])

    assert [(line["delay"], line["step"]) for line in _lines(scripts)] == [(0, 1), (1, 2)]


def test_the_scripts_one_roll_picks_between_share_a_step_at_each_delay():
    scripts = _scripts(quest_starts=[_start(100, (7, 50), (8, 50))],
                       generic_talk=[_talk(7, 1, delay=3), _talk(7, 2, delay=9),
                                     _talk(8, 3, delay=3), _talk(8, 4, delay=9)])

    assert [(line["id"], line["step"]) for line in _lines(scripts)] == \
        [(1, 1), (3, 1), (2, 2), (4, 2)]


def _model(name, model):
    # What query_creature_voices answers for a creature with no humanoid display.
    return {"name": name, "DisplayRaceID": None, "DisplaySexID": 0, "npc_sound_name": None,
            "ModelID": model}


def test_a_speaker_with_no_humanoid_display_is_kept_and_carries_its_model():
    # Kum'isha is a Broken: no race or sex to voice her by, so her model names the voice.
    creatures = {7363: [_model("Kum'isha the Collector", 29)]}
    result = {"end": {10: ("A", [_line(3475, [7363], male="The rift opens.",
                                       female="The rift opens, dear.")])}}

    [row] = corpus_rows(result, creatures)

    assert (row["ModelID"], row["DisplayRaceID"], row["DisplaySexID"]) == (29, None, 0)
    # Read as male: the display has no sex, and male is what broadcast_text writes first.
    assert row["text"] == "The rift opens."


def test_a_humanoid_speakers_row_has_no_model():
    [row] = corpus_rows({"end": {10: ("A", [_line(500, [1])])}}, CREATURES)

    assert row["ModelID"] is None


def test_two_npcs_on_one_model_are_a_row_each():
    # One voice slot, but each NPC is still its own speaker of the line.
    creatures = {2546: [_model("Fleet Master Firallon", 127)],
                 2610: [_model("Shakes O'Breen", 127)]}
    rows = corpus_rows({"end": {10: ("A", [_line(500, [2546, 2610])])}}, creatures)

    assert [(r["name"], r["ModelID"]) for r in rows] == [
        ("Fleet Master Firallon", 127), ("Shakes O'Breen", 127)]


def test_a_model_voiced_line_is_gathered_but_not_generated():
    from tts_cli.corpus import NO_VOICE, _skip_reason

    row = {"source": "followup", "cleanedText": "The rift opens.", "voice_name": "model-29"}
    assert _skip_reason(row) == NO_VOICE
    # No rewrite of the text can lift it, so it wins over invalid-chars.
    assert _skip_reason({**row, "cleanedText": "Hi $N."}) == NO_VOICE
    assert _skip_reason({**row, "voice_name": "broken-male"}) is None


def test_creature_voices_keep_a_model_only_where_no_humanoid_display_exists():
    rows = [
        # entry, name, DisplayRaceID, DisplaySexID, npc_sound_name, ModelID
        (7363, "Kum'isha the Collector", None, None, None, 29),
        # Two sound names for one model are one model voice.
        (7806, "Homing Robot OOX-09/HL", None, None, "RobotGreetings", 111),
        (7806, "Homing Robot OOX-09/HL", None, None, None, 111),
        # A patch variant with a humanoid display wins: its quest rows use that one.
        (1, "Belgrum", None, None, None, 50),
        (1, "Belgrum", 3, 0, "DwarfMaleStandardNPCGreetings", 51),
        # And two humanoid models of one race are still one voice, as before ModelID was read.
        (1, "Belgrum", 3, 0, "DwarfMaleStandardNPCGreetings", 52),
    ]

    voices = creature_voices(rows)

    assert voices == {
        1: [{"name": "Belgrum", "DisplayRaceID": 3, "DisplaySexID": 0,
             "npc_sound_name": "DwarfMaleStandardNPCGreetings", "ModelID": None}],
        7363: [_model("Kum'isha the Collector", 29)],
        7806: [_model("Homing Robot OOX-09/HL", 111)],
    }
