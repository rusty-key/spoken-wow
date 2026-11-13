import shutil
import subprocess

import pytest

import json

from tts_cli.quest_text import (fill_amounts, in_game, left_out, lua_string, objective_amounts, quest_text,
                                removed_quests, render)


def _line(quest, source, text, npc=288, gender=None, title="Growling Gut"):
    line_id = f"q:{quest}:{source}" + (f":{gender}" if gender else "")
    return {"lineId": line_id, "source": source, "questId": quest, "questTitle": title,
            "npcId": npc, "originalText": text, "playerGender": gender}


def test_each_quest_keeps_its_offer_and_completion_and_not_its_progress():
    corpus = {"lines": [_line(5, "accept", "Find my pack."), _line(5, "progress", "Not yet?"),
                        _line(5, "complete", "You found it!")]}
    assert quest_text(corpus) == {5: {"accept": "Find my pack.", "complete": "You found it!"}}


def test_a_quest_with_only_its_progress_shows_it_as_its_offer():
    corpus = {"lines": [_line(98888, "progress", "Back so soon?"),
                        _line(6, "progress", "Not yet?"), _line(6, "complete", "Done!")]}
    assert quest_text(corpus) == {98888: {"accept": "Back so soon?"}, 6: {"complete": "Done!"}}


def test_gossip_and_follow_up_lines_are_not_a_quest_s_words():
    corpus = {"lines": [_line(5, "accept", "Find my pack."), _line(5, "followup", "Thanks!"),
                        dict(_line(0, "gossip", "Move along."), questId=None)]}
    assert quest_text(corpus) == {5: {"accept": "Find my pack."}}


def test_the_placeholders_are_kept_for_the_addon_to_fill():
    text = "Hello, $N the $c.$B$BMy $gbrother:sister;, a $R, needs you."
    assert quest_text({"lines": [_line(5, "accept", text)]})[5]["accept"] == text


def test_an_objective_s_amount_is_written_in_from_the_client_s_objectives():
    # Efficient Games' quests.enUS, as Forever's client has them: 94237 asks for 200 shot.
    sets = {"1.60.1.70334": {"quests": {"94237": {"objectives": [{"amount": 1}, {"amount": 100}]}}},
            "1.60.1.70338": {"quests": {"94237": {"objectives": [{"amount": 1}, {"amount": 200}]},
                                        "94004": {"objectives": [{"amount": 1}, {"amount": 1}]}}}}
    amounts = objective_amounts(sets)
    assert amounts == {94237: [1, 200], 94004: [1, 1]}
    corpus = {"lines": [_line(94237, "accept", "<The note is requesting $2oa Crafted Solid Shot.>"),
                        _line(94004, "accept", "<The note is requesting $2oa Elixir of Ogre's Strength.>")]}
    texts = quest_text(corpus, amounts=amounts)
    assert texts[94237]["accept"] == "<The note is requesting 200 Crafted Solid Shot.>"
    assert texts[94004]["accept"] == "<The note is requesting 1 Elixir of Ogre's Strength.>"


def test_an_amount_not_known_keeps_its_token():
    assert fill_amounts("requesting $2oa shot", None) == "requesting $2oa shot"
    assert fill_amounts("requesting $3oa shot", [1, 200]) == "requesting $3oa shot"
    assert quest_text({"lines": [_line(5, "accept", "Bring $2oa.")]})[5]["accept"] == "Bring $2oa."


def test_a_gendered_pair_is_one_text():
    corpus = {"lines": [_line(60, "accept", "Hello, $ggood sir:my lady;!", gender="m"),
                        _line(60, "accept", "Hello, $ggood sir:my lady;!", gender="f")]}
    assert quest_text(corpus) == {60: {"accept": "Hello, $ggood sir:my lady;!"}}


def test_where_givers_differ_the_words_most_of_them_say():
    corpus = {"lines": [_line(7795, "complete", "Fantastic.", npc=1),
                        _line(7795, "complete", "With all the donations...", npc=2),
                        _line(7795, "complete", "With all the donations...", npc=3)]}
    assert quest_text(corpus)[7795]["complete"] == "With all the donations..."


def test_a_tie_goes_to_the_words_the_corpus_has_first():
    corpus = {"lines": [_line(172, "accept", "Lord Ebonlocke sent me.", npc=271),
                        _line(172, "accept", "You're willing to help us?", npc=271),
                        _line(172, "accept", "You're willing to help us?", npc=14451),
                        _line(172, "accept", "Lord Ebonlocke sent me.", npc=14451)]}
    assert quest_text(corpus)[172]["accept"] == "Lord Ebonlocke sent me."


def test_an_ignored_line_has_no_words():
    corpus = {"lines": [_line(5, "accept", "Find my pack."), _line(5, "complete", "You found it!")]}
    assert quest_text(corpus, {"q:5:accept"}) == {5: {"complete": "You found it!"}}


def test_a_quest_the_compendium_leaves_out_has_no_words(tmp_path):
    overrides = tmp_path / "compendium_overrides.json"
    overrides.write_text(json.dumps({"quests": [
        {"id": 236, "remove": True, "source": "removed in the beta"},
        {"ids": [708, 909], "remove": True, "source": "old copies"},
        {"id": 5, "title": "Growling Gut", "source": "a title"}]}), encoding="utf-8")
    assert removed_quests(str(overrides)) == {236, 708, 909}
    assert removed_quests(str(tmp_path / "none.json")) == set()
    corpus = {"lines": [_line(5, "accept", "Find my pack."), _line(236, "accept", "Wait for word.")]}
    assert set(quest_text(corpus, removed={236})) == {5}


def test_one_rule_leaves_out_debris_quests_wholly_ignored_and_removals():
    corpus = {"lines": [_line(1, "accept", "Test.", title="The Chow Quest"),
                        _line(8514, "accept", "Tally: $2113w."), _line(8516, "accept", "Bring bars."),
                        _line(8516, "complete", "Tally: $2113w."), _line(236, "accept", "Wait."),
                        _line(5, "accept", "Find my pack.")]}
    ignored = {"q:8514:accept", "q:8516:complete"}
    # 8516 keeps a line no one ignored, so it is still listed, without the ignored one's words.
    assert left_out(corpus, ignored, {236}) == {1, 8514, 236}
    assert set(quest_text(corpus, ignored, {236})) == {8516, 5}


def test_the_test_quest_and_those_not_yet_implemented_are_left_out():
    corpus = {"lines": [_line(1, "accept", "$Tpunk;! NEW TEST AGAIN", title="The Chow Quest"),
                        _line(3482, "accept", "A box.", title="<NYI> <TXT> The Pocked Black Box"),
                        _line(5, "accept", "Find my pack.")]}
    assert set(quest_text(corpus)) == {5}
    assert not in_game(1, "The Chow Quest") and in_game(5, "Growling Gut")


def test_a_windows_line_break_is_one_line_break():
    assert quest_text({"lines": [_line(5, "accept", "One.\r\nTwo.")]})[5]["accept"] == "One.\nTwo."


def test_quotes_backslashes_and_line_breaks_are_lua_escapes():
    assert lua_string('Say "hi" \\ there\nnow') == '"Say \\"hi\\" \\\\ there\\nnow"'


def test_the_file_is_lua_the_addon_can_load(tmp_path):
    texts = {7: {"complete": 'Is it "done"?'}, 5: {"complete": "Thanks, $N!", "accept": "Find it.$BGo."}}
    lua = render(texts)
    assert lua.startswith("-- AUTO-GENERATED by pipelines/quests/tools/export_quest_text.py")
    assert "make quests-compendium-text" in lua
    # Quests in id order, and each quest's words in the order a player meets them.
    assert lua.index("[5] = {") < lua.index("[7] = {")
    assert lua.index('accept = "Find it.$BGo."') < lua.index('complete = "Thanks, $N!"')
    luajit = shutil.which("luajit")
    if not luajit:
        pytest.skip("no luajit to load the file with")
    path = tmp_path / "QuestText.lua"
    path.write_text(lua, encoding="utf-8")
    result = subprocess.run([luajit, "-e", f"dofile([[{path}]]) "
                             "io.write(SpokenQuestsText[7].complete, '|', SpokenQuestsText[5].accept)"],
                            capture_output=True, text=True, check=True)
    assert result.stdout == 'Is it "done"?|Find it.$BGo.'
