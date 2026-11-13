"""The addon's translated quest-giver names, which export-giver-names writes."""
import glob
import os
import re

from test_gossip_text import ADDON, FOREVER, toc
import pytest

from tts_cli.giver_names import (check_forever_toc, forever_toc_mismatch, givers, localized_names,
                                 lua_string, render, write_every_language, write_giver_names,
                                 write_names_xml)


def line(source, kind, npc_id, name, quest_id=1):
    return {"lineId": f"q:{quest_id}:{source}:{npc_id}", "source": source, "questId": quest_id,
            "questTitle": f"Quest {quest_id}", "npcType": kind, "npcId": npc_id, "npcName": name,
            "originalText": "Text.", "fileName": f"{quest_id}-{source}"}


CORPUS = {"lines": [
    line("accept", "creature", 237, "Farmer Furlbrow", 1),
    line("accept", "creature", 197, "Eagan Peltskinner", 2),
    line("accept", "item", 1307, "Gold Pickup Schedule", 3),
    # Speaks, but gives no quest: the quest log never asks for them.
    line("complete", "creature", 240, "Marshal Dughan", 1),
]}


def test_the_givers_are_the_ones_the_pack_hands_the_quest_log():
    assert givers(CORPUS) == {
        ("creature", "237"): "Farmer Furlbrow",
        ("creature", "197"): "Eagan Peltskinner",
        ("item", "1307"): "Gold Pickup Schedule",
    }


def test_an_ignored_line_gives_no_quest():
    assert ("creature", "197") not in givers(CORPUS, {"q:2:accept:197"})


def test_only_givers_with_a_name_of_their_own_are_written():
    names = {
        ("creature", "237"): "Bauer Furlbrow",
        # Not translated: the pack's English table already answers.
        ("creature", "197"): "Eagan Peltskinner",
        ("item", "1307"): "Goldabholplan",
        # Not a giver.
        ("creature", "240"): "Marschall Dughan",
    }

    assert localized_names(givers(CORPUS), names) == {
        "creature": {237: "Bauer Furlbrow"},
        "gameobject": {},
        "item": {1307: "Goldabholplan"},
    }


def test_a_name_is_a_valid_lua_string_whatever_it_holds():
    assert lua_string('Remy "Two Times"') == '"Remy \\"Two Times\\""'
    assert lua_string("a\\b") == '"a\\\\b"'


def test_the_file_builds_nothing_on_a_client_in_another_language():
    text = render("deDE", {"creature": {237: "Bauer Furlbrow"}, "gameobject": {}, "item": {}})

    guard = text.index('if GetLocale() ~= "deDE" then')
    assert guard < text.index("GiverNames = {")
    assert '[237] = "Bauer Furlbrow",' in text


def test_an_export_that_changed_nothing_is_the_same_file(tmp_path):
    table = {"creature": {237: "Bauer Furlbrow", 12: "Zwölf"}, "gameobject": {}, "item": {}}
    path = write_giver_names(str(tmp_path), "deDE", table)
    first = open(path, "rb").read()
    write_giver_names(str(tmp_path), "deDE", table)

    assert open(path, "rb").read() == first
    assert first.index(b"[12]") < first.index(b"[237]")


def test_names_xml_loads_exactly_the_files_written(tmp_path):
    path = write_names_xml(str(tmp_path), ["deDE", "ruRU"])
    text = open(path, encoding="utf-8").read()

    assert '<Script file="deDE.lua"/>' in text and '<Script file="ruRU.lua"/>' in text
    assert text.count("<Script") == 2


def test_the_export_names_the_forever_toc_lines_a_language_change_needs(tmp_path):
    toc_path = tmp_path / "Spoken_Quests.toc"
    toc_path.write_text("addon.xml\nLocale\\Names\\deDE.lua [AllowLoadTextLocale deDE]\n"
                        "Locale\\Names\\ruRU.lua [AllowLoadTextLocale ruRU]\n", encoding="utf-8")

    assert forever_toc_mismatch(str(toc_path), ["deDE", "ruRU"]) == ([], [])
    assert forever_toc_mismatch(str(toc_path), ["deDE", "koKR"]) == (
        ["Locale\\Names\\koKR.lua [AllowLoadTextLocale koKR]"],
        ["Locale\\Names\\ruRU.lua [AllowLoadTextLocale ruRU]"])


def _addon_names(tmp_path, toc_text):
    names = tmp_path / "Spoken_Quests" / "Locale" / "Names"
    names.mkdir(parents=True)
    if toc_text is not None:
        (tmp_path / "Spoken_Quests" / "Spoken_Quests.toc").write_text(toc_text, encoding="utf-8")
    return str(names)


def test_the_export_stops_when_the_forever_toc_does_not_list_the_files_it_wrote(tmp_path):
    names = _addon_names(tmp_path, "Locale\\Names\\deDE.lua [AllowLoadTextLocale deDE]\n")

    assert check_forever_toc(names, ["deDE"]) is True
    with pytest.raises(SystemExit) as stopped:
        check_forever_toc(names, ["deDE", "koKR"])
    assert "add:    Locale\\Names\\koKR.lua [AllowLoadTextLocale koKR]" in str(stopped.value)
    with pytest.raises(SystemExit) as stopped:
        check_forever_toc(names, [])
    assert "remove: Locale\\Names\\deDE.lua [AllowLoadTextLocale deDE]" in str(stopped.value)


def test_a_language_the_export_drops_loses_its_file(tmp_path):
    names = _addon_names(tmp_path, "Locale\\Names\\deDE.lua [AllowLoadTextLocale deDE]\n")
    for lang in ("deDE", "ruRU"):
        write_giver_names(names, lang, localized_names({}, {}))
    found = givers(CORPUS)

    written, removed, checked = write_every_language(
        names, found, {"deDE": {("creature", "237"): "Bauer Furlbrow"}})

    assert checked is True
    assert [os.path.basename(path) for path, _ in written] == ["deDE.lua"]
    assert removed == [os.path.join(names, "ruRU.lua")]
    assert sorted(os.listdir(names)) == ["Names.xml", "deDE.lua"]


def test_an_export_stopped_by_the_toc_leaves_every_file_as_it_was(tmp_path):
    names = _addon_names(tmp_path, "Locale\\Names\\deDE.lua [AllowLoadTextLocale deDE]\n"
                                   "Locale\\Names\\ruRU.lua [AllowLoadTextLocale ruRU]\n")
    for lang in ("deDE", "ruRU"):
        write_giver_names(names, lang, localized_names({}, {}))
    write_names_xml(names, ["deDE", "ruRU"])
    before = {name: open(os.path.join(names, name), encoding="utf-8").read()
              for name in os.listdir(names)}

    with pytest.raises(SystemExit):
        write_every_language(names, givers(CORPUS), {"deDE": {("creature", "237"): "Bauer Furlbrow"}})

    assert {name: open(os.path.join(names, name), encoding="utf-8").read()
            for name in os.listdir(names)} == before


def test_the_export_says_so_when_there_is_no_toc_to_check(tmp_path):
    assert check_forever_toc(_addon_names(tmp_path, None), ["deDE"]) is False


def test_forever_loads_only_its_own_names_file_and_the_other_clients_load_every_one():
    # Names.xml is the export's own list. Forever's .toc must name the same languages, and a
    # file left on disk that Names.xml dropped must not be loaded anywhere.
    names = os.path.join(ADDON, "Locale", "Names")
    with open(os.path.join(names, "Names.xml"), encoding="utf-8") as f:
        langs = sorted(re.findall(r'<Script file="(\w+)\.lua"/>', f.read()))
    assert langs
    assert sorted(os.path.splitext(name)[0]
                  for name in os.listdir(names) if name.endswith(".lua")) == langs
    for path in glob.glob(os.path.join(ADDON, "*.toc")):
        name = os.path.basename(path)
        lines = toc(name)
        if name in FOREVER:
            assert "Locale\\Names\\Names.xml" not in lines
            assert sorted(line for line in lines if line.startswith("Locale\\Names\\")) == sorted(
                f"Locale\\Names\\{lang}.lua [AllowLoadTextLocale {lang}]" for lang in langs)
        else:
            assert "Locale\\Names\\Names.xml" in lines, name
    with open(os.path.join(ADDON, "addon.xml"), encoding="utf-8") as f:
        assert "Locale\\Names" not in f.read()


def test_a_giver_named_only_by_a_placeholder_has_no_english_name():
    corpus = {"lines": [line("accept", "gameobject", 649051, "null", 95999)]}

    found = givers(corpus)
    assert found == {("gameobject", "649051"): None}
    # A language that has a name for it writes it: there is no English to fall back on.
    assert localized_names(found, {("gameobject", "649051"): "Kiste"}) == {
        "creature": {}, "gameobject": {649051: "Kiste"}, "item": {}}
