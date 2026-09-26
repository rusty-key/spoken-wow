import os

from tts_cli.build import (build_tables, escape_lua_string, module_toc,
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
         "originalText": "Not yet.", "generatable": True},
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


def test_quest_id_lookup_includes_progress():
    """Progress text is voiced, so the addon can resolve its quest like any other line."""
    assert "progress" in _tables()["quest_id_lookups"]


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
    assert toc.count("-DataModule-Maps: ") == 2
    # The two generations must agree, or the pack means one thing to each reader.
    maps = [line.split(": ", 1)[1] for line in toc.splitlines() if "-DataModule-Maps: " in line]
    assert maps[0] == maps[1]


def test_toc_nests_the_pack_under_the_player():
    # Group is the one the client reads (11.1.0+), and its value is the main addon's *name*,
    # so it is the folder and not the title. X-Part-Of carries the title for addon managers,
    # and X-Child-Of a folder again. Three keys a rename can silently swap between.
    toc = module_toc("VoiceOverReduxAudio", [])

    # The folder the packs nest under is the addon's, which the rename moved; the pack
    # folders themselves did not move, so these are the only names here that change.
    assert "## Group: SpokenQuests\n" in toc
    assert "## X-Part-Of: Spoken\n" in toc
    assert "## X-Child-Of: SpokenQuests\n" in toc


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
