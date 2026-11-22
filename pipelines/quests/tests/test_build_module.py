"""Building a module over a staged store, which may hold mp3 or ogg.

The store on disk is always mp3; scripts/quests/package-audio.sh stages a transcoded copy and
hands that to `build --store`, and that copy is ogg for the packs this project ships. So
the module's sound paths have to follow the files rather than assume an extension.
"""
import json
import os
import shutil

import pytest

from tts_cli.build import GOSSIP_TEXT_TABLES, build_module, icon_source

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


def test_a_line_with_no_words_ships_no_audio_but_keeps_its_giver(tmp_path):
    corpus = {"lines": CORPUS["lines"] + [
        {"lineId": "q:3646:accept", "source": "accept", "questId": 3646,
         "questTitle": "Membership Card Renewal", "npcId": 8738, "npcName": "Vazario Linkgrease",
         "npcType": "creature", "fileName": "3646-accept", "originalText": "\n",
         "generatable": True}]}
    store = _store(tmp_path, "quests/5-accept.ogg", "quests/3646-accept.ogg")

    report = build_module(corpus, store, str(tmp_path / "dist"), "Mod")

    generated = tmp_path / "dist" / "Mod" / "generated"
    assert not (generated / "sounds" / "quests" / "3646-accept.ogg").exists()
    assert report["audioFiles"] == 1
    assert "[3646] = 8738" in (generated / "questlog_npc_lookups.lua").read_text(encoding="utf-8")


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
                 title="Spoken Audio: Quests - Horde")

    with open(tmp_path / "dist" / "Mod" / "Mod.toc", encoding="utf-8") as f:
        assert "## Title: |cffb48cffSpoken|r Audio: Quests - Horde\n" in f.read()


def test_the_toc_names_the_forever_client(tmp_path):
    # Forever marks a pack whose Interface it does not list incompatible, which the player's
    # checkAddonVersion switch cannot override, so every client the packs ship for is named.
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    with open(tmp_path / "dist" / "Mod" / "Mod.toc", encoding="utf-8") as f:
        assert f.read().startswith("## Interface: 11509, 20506, 16001\n")


def test_the_pack_ships_an_icon_the_toc_points_at(tmp_path):
    # Without it the AddOns list shows a red question mark against every pack. The path is
    # absolute from Interface\AddOns, so it has to name this module's own folder.
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    module = tmp_path / "dist" / "Mod"
    with open(module / "Mod.toc", encoding="utf-8") as f:
        assert "## IconTexture: Interface\\AddOns\\Mod\\icon.tga\n" in f.read()
    assert (module / "icon.tga").is_file()


def test_a_language_pack_wears_its_badged_icon(tmp_path):
    # Otherwise a language's packs look like English's in the AddOns list.
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX")

    with open(tmp_path / "dist" / "Mod" / "icon.tga", "rb") as shipped, \
            open(icon_source("esMX"), "rb") as badged, open(icon_source(), "rb") as english:
        data = shipped.read()
        assert data == badged.read()
        assert data != english.read()


def test_a_language_without_a_badge_can_wear_englishs_mark(tmp_path):
    # A team's pack in a language nobody drew a badge for; its title and TOC name the language.
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="jaJP", icon_language="enUS",
                 toc_extra=[("X-Spoken-LanguageName", "Japanese")])

    with open(tmp_path / "dist" / "Mod" / "icon.tga", "rb") as shipped, open(icon_source(), "rb") as english:
        assert shipped.read() == english.read()
    with open(tmp_path / "dist" / "Mod" / "Mod.toc", encoding="utf-8") as f:
        toc = f.read()
    assert "## X-SpokenQuests-Language: jaJP\n" in toc
    assert "## X-Spoken-LanguageName: Japanese\n" in toc


def test_a_language_without_a_badge_is_still_an_error_by_default(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg")

    with pytest.raises(FileNotFoundError, match="no icon for jaJP"):
        build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="jaJP")


def test_the_cli_passes_the_icon_language_and_toc_extras(tmp_path):
    import subprocess
    import sys
    store = _store(tmp_path, "quests/5-accept.ogg")
    import gzip
    corpus = tmp_path / "corpus.json.gz"
    with gzip.open(corpus, "wt", encoding="utf-8") as f:
        json.dump({"lines": [{**line, "voice": None} for line in CORPUS["lines"]]}, f)
    quests = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    subprocess.run([sys.executable, "cli-main.py", "build", "--store", store, "--corpus", str(corpus),
                    "--dist", str(tmp_path / "dist"), "--module", "Mod", "--pack", "all",
                    "--ignored", str(tmp_path / "none.json"), "--overrides", str(tmp_path / "none.lua"),
                    "--language", "jaJP", "--icon-language", "enUS",
                    "--toc-extra", "X-Spoken-Team=stimmen", "--toc-extra", "X-Spoken-TeamName=Die Stimmen"],
                   cwd=quests, check=True, capture_output=True)
    with open(tmp_path / "dist" / "Mod" / "Mod.toc", encoding="utf-8") as f:
        toc = f.read()
    assert "## X-Spoken-Team: stimmen\n## X-Spoken-TeamName: Die Stimmen\n" in toc


def test_the_length_table_measures_ogg(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    assert '["5-accept"] = 0.3' in _sound_length_table(tmp_path)


def test_a_store_of_pointers_takes_its_lengths_from_durations_json(tmp_path):
    root = tmp_path / "store"
    (root / "quests").mkdir(parents=True)
    (root / "gossip").mkdir()
    (root / "gossip" / "abc123.ogg").write_text("spoken-clip-pointer encodings/aa 5\n")
    (root / "quests" / "5-accept.ogg").write_text("spoken-clip-pointer encodings/bb 5\n")
    (root / "durations.json").write_text('{"quests/5-accept": 26, "gossip/abc123": 1.25}')
    build_module(CORPUS, str(root), str(tmp_path / "dist"), "Mod")
    table = _sound_length_table(tmp_path)
    assert '["5-accept"] = 26.0' in table
    assert '["abc123"] = 1.25' in table
    assert table.index("5-accept") < table.index("abc123")


def test_word_times_ship_for_the_clips_a_pack_carries(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg")
    # The gossip clip has times but is not in this store, so its times would be dead weight.
    with open(os.path.join(store, "word-times.json"), "w", encoding="utf-8") as f:
        json.dump({"quests/5-accept": "0 0 .42 1.5", "gossip/abc123": "0 .5"}, f)

    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    with open(tmp_path / "dist" / "Mod" / "generated" / "word_times_table.lua",
              encoding="utf-8") as f:
        lua = f.read()
    assert "Mod.WordTimesByFileName = " in lua
    assert '["5-accept"] = "0 0 .42 1.5"' in lua
    assert "abc123" not in lua
    assert "generated\\word_times_table.lua" in _toc(tmp_path)
    assert report["tableRows"]["word_times_table"] == 1


def _text_table(tmp_path, take_text):
    store = _store(tmp_path, "quests/5-accept.ogg")
    with open(os.path.join(store, "take-text.json"), "w", encoding="utf-8") as f:
        json.dump(take_text, f)
    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")
    with open(tmp_path / "dist" / "Mod" / "generated" / "text_table.lua", encoding="utf-8") as f:
        return f.read(), report


def test_text_ships_for_the_clips_a_pack_carries(tmp_path):
    # The gossip clip is not in this store, so its text would be dead weight.
    lua, report = _text_table(tmp_path, {"quests/5-accept": "Pack words.", "gossip/abc123": "No."})

    assert "Mod.TextByFileName = " in lua
    assert '["5-accept"] = "Pack words."' in lua
    assert ('(VoiceOver.Language.GetTextLanguage and VoiceOver.Language:GetTextLanguage() '
            'or VoiceOver.Language:GetClientLanguage()) ~= "enUS" then return end') in lua
    assert "abc123" not in lua
    assert "generated\\text_table.lua" in _toc(tmp_path)
    assert report["tableRows"]["text_table"] == 1


def test_a_language_pack_carries_the_words_of_its_lines_without_a_take(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg")
    tables = {"take-text.json": {"quests/5-accept": "Grabada."},
              "line-text.json": {"quests/5-accept": "Escrita.", "quests/5-complete": "Sin grabar.",
                                 "quests/9-accept": "Otro paquete."}}
    for name, table in tables.items():
        with open(os.path.join(store, name), "w", encoding="utf-8") as f:
            json.dump(table, f)

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                 include={"quests/5-accept", "quests/5-complete"})

    generated = tmp_path / "dist" / "Mod" / "generated"
    takes = (generated / "text_table.lua").read_text(encoding="utf-8")
    lines = (generated / "line_text_table.lua").read_text(encoding="utf-8")
    assert '["5-accept"] = "Grabada."' in takes and "Sin grabar" not in takes
    assert '["5-complete"] = "Sin grabar."' in lines
    assert "Escrita" not in lines and "Otro paquete" not in lines


def test_a_language_pack_carries_every_quests_title(tmp_path):
    # A client knows only the titles of quests it has shown: without these the Compendium showed the
    # English one for every quest the player never opened.
    store = _store(tmp_path, "quests/5-accept.ogg")
    with open(os.path.join(store, "quest-titles.json"), "w", encoding="utf-8") as f:
        json.dump({"5": "Un almuerzo gratis", "9": 'Otro "paquete"'}, f)

    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                          include={"quests/5-accept"})

    lua = (tmp_path / "dist" / "Mod" / "generated" / "title_table.lua").read_text(encoding="utf-8")
    assert "Mod.TitleByQuestID = " in lua
    assert '[5] = "Un almuerzo gratis"' in lua
    assert '[9] = "Otro \\"paquete\\""' in lua
    assert '~= "esMX" then return end' in lua
    assert "generated\\title_table.lua" in _toc(tmp_path)
    assert report["tableRows"]["title_table"] == 2


def test_text_survives_lua_quoting(tmp_path):
    # A raw newline or an unescaped quote stops the whole pack from loading.
    lua, _ = _text_table(tmp_path, {"quests/5-accept": 'Say "hi"\nC:\\x \tПривет'})

    # Escaped once: escaped twice, a newline reads back as a backslash and an n in game.
    assert '["5-accept"] = "Say \\"hi\\"\\nC:\\\\x \\009Привет"' in lua


def test_a_store_without_text_ships_an_empty_table(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg")
    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")
    assert report["tableRows"]["text_table"] == 0


def test_a_store_without_word_times_ships_an_empty_table(tmp_path):
    store = _store(tmp_path, "quests/5-accept.ogg")

    report = build_module(CORPUS, store, str(tmp_path / "dist"), "Mod")

    assert report["tableRows"]["word_times_table"] == 0


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


GOSSIP_TEXT_FILES = tuple(name + ".lua" for name in GOSSIP_TEXT_TABLES)


@pytest.mark.parametrize("stored, include, carried", [
    ("quests/5-accept.ogg", {"quests/5-accept"}, False),  # Alliance, Horde, Shared
    ("quests/5-accept.ogg", set(), False),
    ("gossip/abc123.ogg", None, True),  # All
    ("gossip/abc123.ogg", {"gossip/abc123"}, True),  # Gossip
    ("gossip/abc123.ogg", {"quests/5-accept", "gossip/abc123"}, True),
])
def test_only_a_pack_with_gossip_audio_carries_the_gossip_text_tables(tmp_path, stored, include,
                                                                     carried):
    # A pack without gossip audio would only pay to parse them.
    build_module(CORPUS, _store(tmp_path, stored), str(tmp_path / "dist"), "Mod", include=include)

    toc = _toc(tmp_path)
    for name in GOSSIP_TEXT_FILES:
        assert (f"generated\\{name}" in toc) is carried
    assert "generated\\quest_id_lookups.lua" in toc
    assert "generated\\npc_body_gossip_file_lookups.lua" in toc


def test_a_language_s_pack_names_its_speakers_in_its_own_language(tmp_path):
    store = _store(tmp_path, "gossip/abc123.ogg")
    names = [{"kind": "creature", "entityId": "68", "name": "Guardia de Ventormenta"},
             {"kind": "creature", "entityId": "999", "name": "Nadie"}]

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX",
                 locale_text=MX_TEXT, locale_names=names)

    table = _generated(tmp_path, "esMX", "npc_name_lookups.lua")
    assert ('if not VoiceOver.Language or VoiceOver.Language:GetClientLanguage() ~= "esMX" '
            'then return end') in table
    assert "ClientLocaleLookups.NPCNameLookupByNPCID" in table
    assert '"Guardia de Ventormenta"' in table
    # An NPC the corpus never names is nothing the addon asks for.
    assert "Nadie" not in table
    assert "generated\\esMX\\npc_name_lookups.lua" in _toc(tmp_path)
    assert '"Stormwind City Guard"' in _generated(tmp_path, "npc_name_lookups.lua")


def test_a_language_pack_without_locale_text_has_no_locale_tables(tmp_path):
    # The faction packs of a language, and every English pack.
    store = _store(tmp_path, "gossip/abc123.ogg")

    build_module(CORPUS, store, str(tmp_path / "dist"), "Mod", language="esMX")

    assert not os.path.exists(tmp_path / "dist" / "Mod" / "generated" / "esMX")
    assert "ClientLocaleLookups" not in _toc(tmp_path)


# A team's pack is named by its slug, and a slug may hold a hyphen: a folder name that is no Lua
# identifier, which written bare into the generated Lua stops every file of the pack compiling.
TEAM_FOLDER = "SpokenQuestsAudioAlliance_esMX_team-two"


@pytest.mark.skipif(shutil.which("luajit") is None, reason="needs luajit")
def test_a_pack_named_by_a_hyphenated_slug_loads_in_lua(tmp_path):
    import subprocess

    store = _store(tmp_path, "quests/5-accept.ogg", "gossip/abc123.ogg")
    report = build_module(CORPUS, store, str(tmp_path / "dist"), TEAM_FOLDER,
                          language="esMX", locale_text=MX_TEXT)

    module_dir = report["moduleDir"]
    with open(os.path.join(module_dir, TEAM_FOLDER + ".toc"), encoding="utf-8") as f:
        files = [line.strip().replace("\\", "/") for line in f
                 if line.strip() and not line.startswith("##")]
    assert files[0] == "Module.lua" and len(files) > 5
    probe = tmp_path / "probe.lua"
    probe.write_text(
        "local registered = {}\n"
        "local event = {}\n"
        "VoiceOver = {DataModules = {Register = function(_, name, module) registered[name] = module end},\n"
        "    Language = {GetClientLanguage = function() return 'esMX' end},\n"
        "    Enums = {SoundEvent = {IsQuestEvent = function(_, e) return e == event end,\n"
        "                           IsGossipEvent = function() return false end}},\n"
        "    format = string.format}\n"
        + "".join(f"assert(loadfile([[{os.path.join(module_dir, name)}]]))()\n" for name in files)
        + f'local module = _G["{TEAM_FOLDER}"]\n'
        f'assert(type(module) == "table" and registered["{TEAM_FOLDER}"] == module)\n'
        'assert(module.LookupLocale == "enUS")\n'
        'assert(module.SoundLengthLookupByFileName["5-accept"])\n'
        'assert(module.ClientLocaleLookups.GossipLookupByNPCID)\n'
        'assert(module:GetSoundPath("5-accept", event) == [[generated\\sounds\\quests\\5-accept.ogg]])\n'
        'print("ok")\n', encoding="utf-8")
    run = subprocess.run(["luajit", str(probe)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert run.stdout.strip() == "ok"


def test_a_pack_named_by_an_identifier_keeps_its_bare_global(tmp_path):
    # Every pack already shipped is named so; writing its global another way would change the
    # bytes of every table file every player holds.
    build_module(CORPUS, _store(tmp_path, "gossip/abc123.ogg"), str(tmp_path / "dist"), "Mod",
                 language="esMX", locale_text=MX_TEXT)
    module = _module_lua(tmp_path)
    assert "\nMod = {}\n\nfunction Mod:GetSoundPath(fileName, event)\n" in module
    assert 'VoiceOver.DataModules:Register("Mod", Mod)\nMod.LookupLocale = "enUS"\n' in module
    assert "\nMod.SoundLengthLookupByFileName = {\n" in _sound_length_table(tmp_path)
    assert "\nMod.ClientLocaleLookups = Mod.ClientLocaleLookups or {}\n" in \
        _generated(tmp_path, "esMX", "npc_gossip_file_lookups.lua")
