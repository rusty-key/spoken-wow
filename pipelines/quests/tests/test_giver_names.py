"""The addon's translated quest-giver names, which export-giver-names writes."""
from tts_cli.giver_names import (givers, localized_names, lua_string, render,
                                 write_giver_names, write_names_xml)


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


def test_a_giver_named_only_by_a_placeholder_has_no_english_name():
    corpus = {"lines": [line("accept", "gameobject", 649051, "null", 95999)]}

    found = givers(corpus)
    assert found == {("gameobject", "649051"): None}
    # A language that has a name for it writes it: there is no English to fall back on.
    assert localized_names(found, {("gameobject", "649051"): "Kiste"}) == {
        "creature": {}, "gameobject": {649051: "Kiste"}, "item": {}}
