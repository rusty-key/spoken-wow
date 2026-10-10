"""The addon's gossip text per client locale, and its aliases, which export-gossip-text writes."""
import glob
import os

from tts_cli.gossip_text import (CLIENT_LOCALES, broadcast_form, gossip_aliases,
                                 gossip_text_tables, load_aliases, render, render_aliases,
                                 write_aliases_json, write_gossip_text)

HASH = "a" * 32
OTHER = "b" * 32
BROADCAST = "b6029-orc-female-standard"
LOCALIZED = "deDE-" + "c" * 32

GUARD = ("creature", 3, "orc", "female", "standard")
SPEAKERS = {f"g:{HASH}": [GUARD], f"g:{OTHER}": [GUARD], f"g:{BROADCAST}": [GUARD],
            f"g:{LOCALIZED}": [GUARD]}


def tables(**kwargs):
    args = {"speakers": SPEAKERS, "english": {}, "translations": {}, "natives": {},
            "broadcast_ids": {}, "broadcast_texts": {}}
    args.update(kwargs)
    return gossip_text_tables(**args)


def test_every_client_locale_but_english_gets_a_table():
    assert set(tables()) == set(CLIENT_LOCALES)
    assert "enUS" not in CLIENT_LOCALES and "itIT" not in CLIENT_LOCALES


def test_a_translation_counts_only_while_it_translates_the_current_english():
    result = tables(english={f"g:{HASH}": "Hello.", f"g:{OTHER}": "Changed."},
                    translations={"deDE": [(f"g:{HASH}", "Hello.", "Hallo."),
                                           (f"g:{OTHER}", "Before.", "Vorher.")]})
    assert result["deDE"]["creature"] == {3: {"Hallo.": HASH}}


def test_a_line_with_no_english_is_found_by_its_own_text():
    result = tables(natives={"deDE": {f"g:{LOCALIZED}": "Grüß dich.",
                                      f"g:{HASH}": "Not native: it has English."}},
                    english={f"g:{HASH}": "Hi."})
    assert result["deDE"]["creature"] == {3: {"Grüß dich.": LOCALIZED}}


def test_broadcast_text_gives_the_form_the_speaker_s_sex_shows():
    result = tables(broadcast_ids={f"g:{HASH}": [6029]},
                    broadcast_texts={"frFR": {6029: ("Bonjour, ami.", "Bonjour, amie.")}})
    assert result["frFR"]["creature"] == {3: {"Bonjour, amie.": HASH}}
    assert broadcast_form(("Male.", ""), "female") == "Male."
    assert broadcast_form(("", "Female."), "male") == "Female."


def test_a_shared_text_goes_to_the_preferred_stem():
    result = tables(broadcast_ids={f"g:{HASH}": [6029], f"g:{BROADCAST}": [6029],
                                   f"g:{LOCALIZED}": [6029]},
                    broadcast_texts={"deDE": {6029: ("Hallo.", "Hallo.")}})
    assert result["deDE"]["creature"] == {3: {"Hallo.": BROADCAST}}


def test_ignored_lines_and_quotes():
    result = tables(broadcast_ids={f"g:{HASH}": [1], f"g:{OTHER}": [2]},
                    broadcast_texts={"deDE": {1: ('Sagt "Hallo".\nJa.', ""), 2: ("Weg.", "")}},
                    ignored={f"g:{OTHER}"})
    # Keyed the way the addon escapes the text it looks up.
    assert result["deDE"]["creature"] == {3: {"Sagt 'Hallo'. Ja.": HASH}}


def test_aliases_tie_one_moment_s_stems():
    speakers = {**SPEAKERS,
                f"g:{'d' * 32}": [("creature", 4, "orc", "male", "standard")],
                "g:b6029-orc-female-gruff": [("creature", 5, "orc", "female", "gruff")]}
    aliases = gossip_aliases(speakers, {
        f"g:{HASH}": [6029], f"g:{BROADCAST}": [6029], f"g:{LOCALIZED}": [6029],
        # Another voice: a different moment.
        f"g:{'d' * 32}": [6029],
        # Another flavor of the same race and gender: only tied to the flavorless lines.
        "g:b6029-orc-female-gruff": [6029],
    })
    assert aliases[HASH] == [BROADCAST, "b6029-orc-female-gruff", LOCALIZED]
    assert aliases[BROADCAST] == [HASH, LOCALIZED]
    assert aliases["b6029-orc-female-gruff"] == [HASH, LOCALIZED]
    assert "d" * 32 not in aliases


def test_a_merged_line_s_file_comes_after_the_moment_s_own():
    aliases = gossip_aliases(SPEAKERS, {f"g:{HASH}": [1], f"g:{BROADCAST}": [1]},
                             merges=[(f"g:{OTHER}", f"g:{HASH}"), (f"g:{LOCALIZED}", f"g:{'e' * 32}")])
    assert aliases[HASH] == [BROADCAST, OTHER]
    assert aliases["e" * 32] == [LOCALIZED]


def test_aliases_json_round_trip(tmp_path):
    path = str(tmp_path / "aliases.json")
    write_aliases_json(path, {HASH: [BROADCAST]})
    assert load_aliases(path) == {HASH: [BROADCAST]}
    assert load_aliases(str(tmp_path / "missing.json")) == {}


def test_a_line_alone_in_its_moment_has_no_aliases():
    assert gossip_aliases(SPEAKERS, {f"g:{HASH}": [1], f"g:{OTHER}": [2]}) == {}


def test_the_files_return_on_another_client_and_are_sorted():
    lua = render("deDE", {"creature": {3: {"b": "x", "a": "y"}}, "gameobject": {}})
    assert 'if GetLocale() ~= "deDE" then' in lua
    assert lua.index('["a"]') < lua.index('["b"]')
    assert render_aliases({HASH: [BROADCAST]}).endswith(
        f'GossipAliases = {{\n    ["{HASH}"] = {{ "{BROADCAST}" }},\n}}\n')


def test_gossip_xml_loads_every_file(tmp_path):
    empty = {lang: {"creature": {}, "gameobject": {}} for lang in CLIENT_LOCALES}
    write_gossip_text(str(tmp_path), empty, {})
    xml = (tmp_path / "Gossip.xml").read_text()
    for lang in CLIENT_LOCALES:
        assert f'<Script file="{lang}.lua"/>' in xml
    assert '<Script file="Aliases.lua"/>' in xml


ADDON = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../addons/Spoken_Quests"))
FOREVER = ("Spoken_Quests.toc", "Spoken_Quests_Mainline.toc")


def toc(name):
    with open(os.path.join(ADDON, name), encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip() and not line.startswith("#")]


def test_forever_loads_only_its_own_locale_and_the_rest_load_every_one():
    # Forever's .toc files name each locale's file with a per-file directive; every other
    # client loads Gossip.xml, which lists them all. A locale missing from either is a client
    # that never finds its gossip text.
    for path in glob.glob(os.path.join(ADDON, "*.toc")):
        name = os.path.basename(path)
        lines = toc(name)
        if name in FOREVER:
            assert "Gossip\\Aliases.lua" in lines and "Gossip\\Gossip.xml" not in lines
            for lang in CLIENT_LOCALES:
                assert f"Gossip\\{lang}.lua [AllowLoadTextLocale {lang}]" in lines
        else:
            assert "Gossip\\Gossip.xml" in lines, name
    with open(os.path.join(ADDON, "addon.xml"), encoding="utf-8") as f:
        assert "Gossip" not in f.read()
