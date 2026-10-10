"""Building a module over a staged store, which may hold mp3 or ogg.

The store on disk is always mp3; scripts/package-audio.sh stages a transcoded copy and
hands that to `build --store`, and that copy is ogg for the packs this project ships. So
the module's sound paths have to follow the files rather than assume an extension.
"""
import os
import shutil

import pytest

from tts_cli.build import build_module

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")

CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "source": "accept", "questId": 5,
         "questTitle": "Growling Gut", "npcId": 288, "npcName": "Jitters",
         "npcType": "creature", "fileName": "5-accept",
         "originalText": "Find my pack.", "generatable": True},
        {"lineId": "g:abc123", "source": "gossip", "questId": None, "questTitle": None,
         "npcId": 68, "npcName": "Stormwind City Guard", "npcType": "creature",
         "fileName": "abc123", "originalText": "Move along.", "generatable": True},
    ],
}


def _store(tmp_path, *files):
    """A staged store holding the named files, each a copy of a fixture tone."""
    root = tmp_path / "store"
    for rel in files:
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        extension = os.path.splitext(rel)[1]
        shutil.copy(os.path.join(FIXTURES, "tone" + extension), target)
    for sub in ("quests", "gossip"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return str(root)


def _module_lua(tmp_path):
    with open(tmp_path / "dist" / "Mod" / "Module.lua", encoding="utf-8") as f:
        return f.read()


def _sound_length_table(tmp_path):
    path = tmp_path / "dist" / "Mod" / "generated" / "sound_length_table.lua"
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_sound_paths_follow_an_ogg_store(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg", "gossip/abc123.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    assert "quests\\%s.ogg" in _module_lua(tmp_path)
    assert "gossip\\%s.ogg" in _module_lua(tmp_path)


def test_sound_paths_follow_an_mp3_store(tmp_path):
    store = _store(tmp_path, "quests/5-accept.mp3", "gossip/abc123.mp3")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    assert "quests\\%s.mp3" in _module_lua(tmp_path)


def test_a_store_of_two_formats_is_refused(tmp_path):
    # GetSoundPath writes one extension for every sound, so a module built from a half
    # transcoded store would resolve half its lines to a file that is not there.
    store = _store(tmp_path, "quests/5-accept.ogg", "gossip/abc123.mp3")

    with pytest.raises(ValueError):
        build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")


def test_an_empty_store_still_builds(tmp_path):
    """The lookup tables are worth building on their own; `build` is also how they are
    regenerated without touching audio."""
    store = _store(tmp_path)

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    assert "quests\\%s.mp3" in _module_lua(tmp_path)


def test_ignored_audio_is_left_out_of_an_ogg_store(tmp_path):
    # The ignore list is derived from the corpus and names mp3s, because the store is mp3.
    # Matching it against a staged ogg copy by name alone would ship the file anyway.
    store = _store(tmp_path, "quests/5-accept.ogg", "gossip/abc123.ogg")

    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod",
                          ignored={"g:abc123": "war effort tally"})

    sounds = tmp_path / "dist" / "Mod" / "generated" / "sounds"
    assert not (sounds / "gossip" / "abc123.ogg").exists()
    assert (sounds / "quests" / "5-accept.ogg").exists()
    assert report["audioFiles"] == 1


def test_a_rebuild_does_not_keep_the_last_build_s_audio(tmp_path):
    # Building into a directory that already holds a module has to leave what this build
    # produced and nothing else. Otherwise switching format ships both: the mp3s the last
    # build copied sit beside the oggs this one did, and the pack is twice the size for
    # audio no lookup entry can reach.
    build_module(CORPUS, _store(tmp_path, "quests/5-accept.mp3", "gossip/abc123.mp3"),
                 str(tmp_path / "dist"), "Mod")

    shutil.rmtree(tmp_path / "store")
    build_module(CORPUS, _store(tmp_path, "quests/5-accept.ogg", "gossip/abc123.ogg"),
                 str(tmp_path / "dist"), "Mod")

    sounds = tmp_path / "dist" / "Mod" / "generated" / "sounds"
    assert sorted(p.name for p in sounds.glob("*/*")) == ["5-accept.ogg", "abc123.ogg"]


def test_a_pack_ships_only_the_audio_it_was_given(tmp_path):
    # The store is staged once and built into several packs, each a subset of it. A pack that
    # copied the whole staging directory would be the 600 MB pack under another name.
    store = _store(tmp_path, "quests/5-accept.ogg", "gossip/abc123.ogg")

    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod",
                          include={"quests/5-accept"})

    sounds = tmp_path / "dist" / "Mod" / "generated" / "sounds"
    assert (sounds / "quests" / "5-accept.ogg").exists()
    assert not (sounds / "gossip" / "abc123.ogg").exists()
    assert report["audioFiles"] == 1


def test_a_whole_store_pack_ships_a_take_the_english_corpus_does_not_name(tmp_path):
    # A language's pack is the whole store (include=None), and a quest line only that
    # language has is in no English corpus. The addon finds a quest sound by its file name
    # alone, so the file and its length entry are all it needs.
    store = _store(tmp_path, "quests/5-accept.ogg", "quests/77-accept.ogg")

    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    sounds = tmp_path / "dist" / "Mod" / "generated" / "sounds"
    assert (sounds / "quests" / "77-accept.ogg").exists()
    assert "77-accept" in _sound_length_table(tmp_path)
    assert report["audioFiles"] == 2


def test_a_pack_still_drops_ignored_audio(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg", "gossip/abc123.ogg")

    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod",
                          include={"quests/5-accept", "gossip/abc123"},
                          ignored={"g:abc123": "war effort tally"})

    assert report["audioFiles"] == 1


def test_the_toc_title_says_which_pack_this_is(tmp_path):
    # Five packs sit in the AddOns list at once and are told apart by their titles; the folder
    # names differ only by a suffix nobody reads.
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod",
                 title="Spoken Quests Audio (Horde)")

    with open(tmp_path / "dist" / "Mod" / "Mod.toc", encoding="utf-8") as f:
        assert "## Title: Spoken Quests Audio (Horde)\n" in f.read()


def test_the_toc_names_the_forever_client(tmp_path):
    # Forever marks a pack whose Interface it does not list incompatible, which the player's
    # checkAddonVersion switch cannot override, so every client the packs ship for is named.
    # 100000 leads for the legacy clients, which read one number.
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    with open(tmp_path / "dist" / "Mod" / "Mod.toc", encoding="utf-8") as f:
        assert f.read().startswith("## Interface: 100000, 11509, 20506, 16001\n")


def test_the_pack_ships_an_icon_the_toc_points_at(tmp_path):
    # Without it the AddOns list shows a red question mark against every pack. The path is
    # absolute from Interface\AddOns, so it has to name this module's own folder.
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    module = tmp_path / "dist" / "Mod"
    with open(module / "Mod.toc", encoding="utf-8") as f:
        assert "## IconTexture: Interface\\AddOns\\Mod\\icon.tga\n" in f.read()
    assert (module / "icon.tga").is_file()


def test_the_length_table_measures_ogg(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    assert '["5-accept"] = 0.3' in _sound_length_table(tmp_path)


def _toc(tmp_path):
    with open(tmp_path / "dist" / "Mod" / "Mod.toc", encoding="utf-8") as f:
        return f.read()


def test_a_language_pack_says_which_language_it_speaks(tmp_path):
    # DataModules.lua reads this key; without it the pack counts as English and plays under
    # English text only.
    build_module(CORPUS, _store(tmp_path, "quests/5-accept.ogg"), str(tmp_path / "dist"), "Mod",
                 language="esMX")
    assert "## X-SpokenQuests-Language: esMX\n" in _toc(tmp_path)


def test_a_language_pack_says_its_tables_are_english(tmp_path):
    # The text-keyed tables are built from the English corpus whatever the pack speaks, and the
    # addon takes a module's tables to be in its own language unless LookupLocale says otherwise.
    build_module(CORPUS, _store(tmp_path, "quests/5-accept.ogg"), str(tmp_path / "dist"), "Mod",
                 language="esMX")
    assert 'Mod.LookupLocale = "enUS"\n' in _module_lua(tmp_path)


def test_an_english_pack_is_unchanged(tmp_path):
    # Every pack already shipped has neither line, and adding them would change the bytes of
    # every English pack for nothing.
    build_module(CORPUS, _store(tmp_path, "quests/5-accept.ogg"), str(tmp_path / "dist"), "Mod")
    assert "X-SpokenQuests-Language" not in _toc(tmp_path)
    assert "LookupLocale" not in _module_lua(tmp_path)


MX_TEXT = [{"lineId": "g:abc123", "originalText": "Move along.", "localeText": "Circule."}]


def _generated(tmp_path, *parts):
    with open(tmp_path / "dist" / "Mod" / "generated" / os.path.join(*parts),
              encoding="utf-8") as f:
        return f.read()


def test_a_language_s_gossip_pack_gets_its_client_s_gossip_table(tmp_path):
    # Keyed by what a Spanish client shows, pointing at the English line's hash, which names
    # the file in every pack.
    store = _store(tmp_path, "gossip/abc123.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                 locale_text=MX_TEXT)

    table = _generated(tmp_path, "esMX", "npc_gossip_file_lookups.lua")
    assert "Mod.ClientLocaleLookups.GossipLookupByNPCID = " in table
    assert '"Circule."' in table and '"abc123"' in table
    assert "Move along." not in table


def test_a_locale_table_loads_only_on_its_own_client(tmp_path):
    store = _store(tmp_path, "gossip/abc123.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                 locale_text=MX_TEXT)

    table = _generated(tmp_path, "esMX", "npc_gossip_file_lookups.lua")
    assert ('if not VoiceOver.Language or VoiceOver.Language:GetClientLanguage() ~= "esMX" '
            'then return end') in table
    assert "generated\\esMX\\npc_gossip_file_lookups.lua" in _toc(tmp_path)
    assert "generated\\esMX\\object_gossip_file_lookups.lua" in _toc(tmp_path)


def test_the_english_tables_are_written_beside_it(tmp_path):
    # They are what matches on an English client that installed the pack to hear Spanish.
    store = _store(tmp_path, "gossip/abc123.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                 locale_text=MX_TEXT)

    assert '"Move along."' in _generated(tmp_path, "npc_gossip_file_lookups.lua")


def test_both_variants_of_a_gendered_line_are_keys(tmp_path):
    store = _store(tmp_path, "gossip/abc123.ogg")
    rows = MX_TEXT + [{"lineId": "g:abc123", "originalText": "Move along.",
                       "localeText": "Circule, amiga."}]

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                 locale_text=rows)

    table = _generated(tmp_path, "esMX", "npc_gossip_file_lookups.lua")
    assert '"Circule."' in table and '"Circule, amiga."' in table


def test_a_locale_row_whose_english_has_changed_is_dropped(tmp_path):
    store = _store(tmp_path, "gossip/abc123.ogg")
    stale = [{"lineId": "g:abc123", "originalText": "Keep moving.", "localeText": "Siga."}]

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                 locale_text=stale)

    assert "Siga." not in _generated(tmp_path, "esMX", "npc_gossip_file_lookups.lua")


def test_an_ignored_line_has_no_locale_entry(tmp_path):
    store = _store(tmp_path, "gossip/abc123.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", ignored={"g:abc123"},
                 language="esMX", locale_text=MX_TEXT)

    assert "Circule." not in _generated(tmp_path, "esMX", "npc_gossip_file_lookups.lua")


def test_locale_text_without_a_language_is_refused(tmp_path):
    store = _store(tmp_path, "gossip/abc123.ogg")

    with pytest.raises(ValueError):
        build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", locale_text=MX_TEXT)


def test_a_language_pack_without_locale_text_has_no_locale_tables(tmp_path):
    # The faction packs of a language, and every English pack.
    store = _store(tmp_path, "gossip/abc123.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX")

    assert not os.path.exists(tmp_path / "dist" / "Mod" / "generated" / "esMX")
    assert "ClientLocaleLookups" not in _toc(tmp_path)
