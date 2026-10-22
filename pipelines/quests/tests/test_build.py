import os

from tts_cli.build import (MODULE_LUA, build_tables, escape_lua_string, module_toc,
                           prune_quest_id_table, quest_search_text)

CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "source": "accept", "questId": 5,
         "questTitle": "Growling Gut", "npcId": 288, "npcName": "Jitters",
         "npcType": "creature", "fileName": "5-accept",
         "originalText": "Find my pack.", "generatable": True},
        {"lineId": "q:5:complete", "source": "complete", "questId": 5,
         "questTitle": "Growling Gut", "npcId": 288, "npcName": "Jitters",
         "npcType": "creature", "fileName": "5-complete",
         "originalText": "You found it!", "generatable": True},
        {"lineId": "q:7:progress", "source": "progress", "questId": 7,
         "questTitle": "Growling Gut", "npcId": 288, "npcName": "Jitters",
         "npcType": "creature", "fileName": "7-progress",
         "originalText": "Not yet.", "generatable": False},
        {"lineId": "g:abc123", "source": "gossip", "questId": None, "questTitle": None,
         "npcId": 68, "npcName": "Stormwind City Guard", "npcType": "creature",
         "fileName": "abc123", "originalText": 'Move along, "citizen".',
         "generatable": True},
        # gendered variant of the same gossip text
        {"lineId": "g:abc123:m", "source": "gossip", "questId": None, "questTitle": None,
         "npcId": 68, "npcName": "Stormwind City Guard", "npcType": "creature",
         "fileName": "m-abc123", "originalText": 'Move along, "citizen".',
         "generatable": True},
        # a gameobject quest giver
        {"lineId": "q:9:accept", "source": "accept", "questId": 9,
         "questTitle": "The Grave", "npcId": 61, "npcName": "A Weathered Grave",
         "npcType": "gameobject", "fileName": "9-accept",
         "originalText": "Here lies nobody.", "generatable": True},
        # an item quest giver
        {"lineId": "q:11:accept", "source": "accept", "questId": 11,
         "questTitle": "The Note", "npcId": 700, "npcName": "Crumpled Note",
         "npcType": "item", "fileName": "11-accept",
         "originalText": "Read me.", "generatable": True},
        # what the questgiver says in chat after quest 5 is turned in, split by $g
        {"lineId": "f:4377:human-male-standard:m", "source": "followup", "questId": 5,
         "questTitle": "Growling Gut", "npcId": 288, "npcName": "Jitters",
         "npcType": "creature", "fileName": "m-4377-human-male-standard",
         "originalText": "Thank you, $gsir:madam;.", "generatable": True},
        {"lineId": "f:4377:human-male-standard:f", "source": "followup", "questId": 5,
         "questTitle": "Growling Gut", "npcId": 288, "npcName": "Jitters",
         "npcType": "creature", "fileName": "f-4377-human-male-standard",
         "originalText": "Thank you, $gsir:madam;.", "generatable": True},
    ],
}


def _tables():
    return {name: data for name, (_, data) in build_tables(CORPUS).items()}


def test_gossip_by_npc_id_maps_text_to_the_bare_hash():
    table = _tables()["npc_gossip_file_lookups"]
    assert table[68]["Move along, 'citizen'."] == "abc123"


def test_gendered_gossip_does_not_leak_a_prefixed_hash():
    """The addon adds m-/f- at resolve time, so a prefixed hash here would make the
    line unreachable for the other gender."""
    table = _tables()["npc_gossip_file_lookups"]
    assert "m-abc123" not in table[68].values()


def test_gossip_by_npc_name():
    table = _tables()["npc_name_gossip_file_lookups"]
    assert table["Stormwind City Guard"]["Move along, 'citizen'."] == "abc123"


def test_gossip_tables_are_split_by_entity_type():
    tables = _tables()
    assert 68 in tables["npc_gossip_file_lookups"]
    assert tables["object_gossip_file_lookups"] == {}


def test_questlog_lookup_maps_quest_to_its_giver_per_type():
    tables = _tables()
    assert tables["questlog_npc_lookups"] == {5: 288}
    assert tables["questlog_object_lookups"] == {9: 61}
    assert tables["questlog_item_lookups"] == {11: 700}


def test_name_lookups_are_split_by_type():
    tables = _tables()
    assert tables["npc_name_lookups"][288] == "Jitters"
    assert tables["object_name_lookups"][61] == "A Weathered Grave"
    assert tables["item_name_lookups"][700] == "Crumpled Note"


def test_quest_id_lookup_is_keyed_by_source_then_title():
    table = _tables()["quest_id_lookups"]
    assert table["accept"]["Growling Gut"] == 5
    assert table["complete"]["Growling Gut"] == 5


def test_quest_id_lookup_omits_progress():
    """Progress text is never voiced, so an entry for it would resolve to silence."""
    assert "progress" not in _tables()["quest_id_lookups"]


def test_followup_lookup_maps_speaker_and_broadcast_id_to_the_bare_stem():
    # Unprefixed, like a gossip hash: the addon adds the player's m-/f- when it resolves.
    assert _tables()["followup_lookups"] == {288: {4377: "4377-human-male-standard"}}


def test_followup_lines_stay_out_of_the_quest_tables():
    # Said in chat, not in the quest dialog: matching its text there would find quest 5 for
    # words its dialog never shows, and a "followup" branch would be a source nothing asks for.
    tables = _tables()
    assert "followup" not in tables["quest_id_lookups"]
    assert tables["quest_id_lookups"]["complete"]["Growling Gut"] == 5
    assert tables["questlog_npc_lookups"] == {5: 288}


def test_followup_lookup_honours_ignores():
    ignored = {"f:4377:human-male-standard:m", "f:4377:human-male-standard:f"}
    tables = {name: data for name, (_, data) in build_tables(CORPUS, ignored).items()}
    assert tables["followup_lookups"] == {}


def test_module_resolves_followup_sounds_only_where_the_player_knows_the_event():
    lua = MODULE_LUA.format(module="Mod", extension=".ogg")
    assert ("elseif Enums.SoundEvent.QuestFollowup and event == Enums.SoundEvent.QuestFollowup "
            "then\n        return format([[generated\\sounds\\followup\\%s.ogg]], fileName)") in lua


def test_prune_collapses_unambiguous_titles_to_a_bare_id():
    pruned = prune_quest_id_table(
        {"accept": {"Unique Title": {"Some NPC": {"some text": 42}}}})
    assert pruned["accept"]["Unique Title"] == 42


def test_prune_keeps_npc_level_when_a_title_is_ambiguous():
    pruned = prune_quest_id_table({"accept": {"Shared": {
        "NPC A": {"text a": 1},
        "NPC B": {"text b": 2},
    }}})
    assert pruned["accept"]["Shared"] == {"NPC A": 1, "NPC B": 2}


def test_prune_keeps_text_level_when_an_npc_is_ambiguous():
    pruned = prune_quest_id_table({"accept": {"Shared": {"NPC A": {
        "text a": 1,
        "text b": 2,
    }}}})
    assert pruned["accept"]["Shared"]["NPC A"] == {"text a": 1, "text b": 2}


def test_escaping_matches_what_the_addon_expects():
    assert escape_lua_string('say "hi"\r\nthere') == "say 'hi'  there"


def test_quest_search_text_is_first_and_last_words():
    words = " ".join(str(i) for i in range(40))
    assert quest_search_text(words) == \
        " ".join(str(i) for i in range(15)) + " " + " ".join(str(i) for i in range(25, 40))


def test_quest_search_text_replaces_line_break_tokens():
    assert "$B" not in quest_search_text("hello$Bworld")


def test_toc_lists_every_generated_file():
    toc = module_toc("VoiceOverReduxAudio", ["a.lua", "b.lua"])
    assert "generated\\a.lua" in toc
    assert "generated\\b.lua" in toc
    assert "Module.lua" in toc
    assert "X-VoiceOver-DataModule-Version: 1" in toc


def test_toc_declares_both_generations_of_the_module_key():
    # The player finds a pack by this key, never by name. It is being renamed, so a pack
    # built now carries both: the new key for this addon, the inherited one so the same
    # zip still loads under the addon's previous release and under upstream AI_VoiceOver.
    toc = module_toc("VoiceOverReduxAudio", [])

    for suffix, value in (("Version", "1"), ("Priority", "100")):
        assert f"## X-SpokenQuests-DataModule-{suffix}: {value}\n" in toc
        assert f"## X-VoiceOver-DataModule-{suffix}: {value}\n" in toc
    # A map list would be read and never used: every pack loads on every map.
    assert "-DataModule-Maps" not in toc


def test_toc_nests_the_pack_under_spoken():
    # Group is the one the client reads (11.1.0+), and its value is the main addon's *name*,
    # so it is the folder and not the title. X-Part-Of carries the title for addon managers,
    # and X-Child-Of a folder again. Three keys a rename can silently swap between.
    toc = module_toc("VoiceOverReduxAudio", [])

    # Every addon and pack sits in the one Spoken group. Named after SpokenQuests, itself a
    # member of that group, the packs showed at the top of the list instead.
    assert "## Group: Spoken\n" in toc
    assert "## X-Part-Of: Spoken\n" in toc
    assert "## X-Child-Of: Spoken_Quests\n" in toc


def test_install_refuses_to_replace_without_force(tmp_path):
    import pytest
    from tts_cli.build import install_module
    built = tmp_path / "dist" / "Mod"
    built.mkdir(parents=True)
    (built / "Module.lua").write_text("x")
    addons = tmp_path / "AddOns"
    (addons / "Mod").mkdir(parents=True)

    with pytest.raises(FileExistsError):
        install_module(str(built), str(addons))


def test_install_moves_the_old_pack_aside_when_forced(tmp_path):
    from tts_cli.build import install_module
    built = tmp_path / "dist" / "Mod"
    built.mkdir(parents=True)
    (built / "Module.lua").write_text("new")
    addons = tmp_path / "AddOns"
    (addons / "Mod").mkdir(parents=True)
    (addons / "Mod" / "old.txt").write_text("keep me")

    report = install_module(str(built), str(addons), force=True)

    assert (addons / "Mod" / "Module.lua").read_text() == "new"
    assert os.path.isfile(report["replaced"] + "/old.txt")


def test_install_into_an_empty_addons_dir(tmp_path):
    from tts_cli.build import install_module
    built = tmp_path / "dist" / "Mod"
    built.mkdir(parents=True)
    (built / "Module.lua").write_text("new")
    addons = tmp_path / "AddOns"
    addons.mkdir()

    report = install_module(str(built), str(addons))

    assert report["replaced"] is None
    assert os.path.isfile(os.path.join(report["target"], "Module.lua"))


def test_install_requires_a_built_module(tmp_path):
    import pytest
    from tts_cli.build import install_module
    with pytest.raises(FileNotFoundError):
        install_module(str(tmp_path / "nope"), str(tmp_path))


def test_an_ignored_line_gets_no_lookup_entry():
    # A line nobody will ever voice must not be findable: the addon cannot tell an entry
    # whose sound was never made from a lookup that is simply broken.
    tables = {name: data for name, (_, data)
              in build_tables(CORPUS, {"g:abc123", "g:abc123:m", "q:9:accept"}).items()}

    assert tables["npc_gossip_file_lookups"].get(68, {}) == {}
    assert 9 not in tables["questlog_object_lookups"]


def test_a_gendered_twin_keeps_the_entry_its_own_line_still_needs():
    # g:abc123 and g:abc123:m are two lines over one gossip text, and the lookup is keyed on
    # the text. Ignoring one of them must leave the other findable.
    tables = {name: data for name, (_, data) in build_tables(CORPUS, {"g:abc123"}).items()}

    assert tables["npc_gossip_file_lookups"][68]["Move along, 'citizen'."] == "abc123"


def test_ignoring_nothing_leaves_every_table_as_it_was():
    assert build_tables(CORPUS, ()) == build_tables(CORPUS)


WORDINGS = {"lines": [
    {"lineId": "q:20:accept", "source": "accept", "questId": 20, "questTitle": "T",
     "npcId": 1, "npcName": "Celindra", "npcType": "creature", "fileName": "20-accept",
     "originalText": "You are the Horde, $c.", "generatable": True},
    {"lineId": "q:20:accept:w1", "source": "accept", "questId": 20, "questTitle": "T",
     "npcId": 2, "npcName": "Modera", "npcType": "creature", "fileName": "20-accept-w1",
     "originalText": "Oh, you are back.", "generatable": True},
    {"lineId": "q:20:accept:w1~orc-male-standard", "source": "accept", "questId": 20,
     "questTitle": "T", "npcId": 3, "npcName": "Grunt", "npcType": "creature",
     "fileName": "20-accept-w1-orc-male-standard", "originalText": "Oh, you are back.",
     "generatable": True},
    {"lineId": "q:21:progress", "source": "progress", "questId": 21, "questTitle": "T",
     "npcId": 1, "npcName": "Celindra", "npcType": "creature", "fileName": "21-progress",
     "originalText": "Well?", "generatable": False},
    {"lineId": "q:21:progress:w1", "source": "progress", "questId": 21, "questTitle": "T",
     "npcId": 2, "npcName": "Modera", "npcType": "creature", "fileName": "21-progress-w1",
     "originalText": "Back so soon?", "generatable": False},
]}


def _wording_tables(corpus=WORDINGS, ignored=()):
    return {name: data for name, (_, data) in build_tables(corpus, ignored).items()}


def test_a_moment_s_wordings_map_each_text_to_its_file():
    assert _wording_tables()["quest_wording_lookups"] == {
        "20-accept": {"You are the Horde, $c.": "20-accept", "Oh, you are back.": "20-accept-w1"},
    }


def test_a_moment_with_one_wording_ships_none():
    assert "5-accept" not in _tables()["quest_wording_lookups"]


def test_a_wording_s_giver_of_another_voice_finds_its_own_file():
    assert _wording_tables()["npc_quest_file_lookups"]["20-accept-w1"][3] == "20-accept-w1-orc-male-standard"


def test_an_ignored_wording_leaves_one_and_no_table():
    assert "20-accept" not in _wording_tables(ignored={"q:20:accept:w1"})["quest_wording_lookups"]


def _speaker(npc_id, name, contribution=None, quest_id=40, kind="creature"):
    line = {"lineId": f"q:{quest_id}:accept", "source": "accept", "questId": quest_id,
            "questTitle": "T", "npcId": npc_id, "npcName": name, "npcType": kind,
            "fileName": f"{quest_id}-accept", "originalText": "Words.", "generatable": True}
    if contribution is not None:
        line["contributionId"] = contribution
    return line


def _names(*lines, table="npc_name_lookups"):
    return _wording_tables({"lines": list(lines)})[table]


def test_an_extracted_name_beats_a_contributed_one_in_either_order():
    # A contribution names the NPC as the contributor's client did, Russian or German, and
    # the quest log showed that name to English players.
    assert _names(_speaker(1, "Sam Sarsaparilla"), _speaker(1, "Sam R", 7, 41))[1] == "Sam Sarsaparilla"
    assert _names(_speaker(1, "Sam R", 7, 41), _speaker(1, "Sam Sarsaparilla"))[1] == "Sam Sarsaparilla"


def test_a_contributed_name_stands_where_there_is_no_other():
    assert _names(_speaker(1, "Todeswache Kristof", 7))[1] == "Todeswache Kristof"


def test_among_names_of_one_kind_the_last_stands():
    assert _names(_speaker(1, "Vaelan"), _speaker(1, "Acride", None, 41))[1] == "Acride"


def test_a_subname_is_not_part_of_the_name():
    greeting = {"lineId": "g:ab12", "source": "gossip", "questId": None, "questTitle": None,
                "npcId": 1, "npcName": "Ishlee Breezewhisper <Skinner>", "npcType": "creature",
                "fileName": "ab12", "originalText": "Hides?", "generatable": True,
                "contributionId": 7}
    tables = _wording_tables({"lines": [greeting]})

    assert tables["npc_name_lookups"][1] == "Ishlee Breezewhisper"
    # The game names the unit without it, so a key that kept it would never match.
    assert tables["npc_name_gossip_file_lookups"] == {"Ishlee Breezewhisper": {"Hides?": "ab12"}}


def test_a_placeholder_is_never_a_name():
    assert 1 not in _names(_speaker(1, "null", 7, kind="gameobject"), table="object_name_lookups")
    assert _names(_speaker(1, "npc 1", 7), _speaker(1, "Raan Wildwind", 7, 41))[1] == "Raan Wildwind"
    assert _names(_speaker(1, "Raan Wildwind", 7), _speaker(1, "npc 1", 7, 41))[1] == "Raan Wildwind"
    assert _names(_speaker(1, "Keg", None, 40, "gameobject"),
                  _speaker(1, "Doodad_BeerKeg101", None, 41, "gameobject"),
                  table="object_name_lookups")[1] == "Keg"


def test_a_name_with_digits_or_a_dash_is_a_name():
    assert _names(_speaker(1, "Homing Robot OOX-17/TN"))[1] == "Homing Robot OOX-17/TN"
