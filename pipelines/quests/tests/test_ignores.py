import json

from tts_cli.ignores import ignored_files, ignored_line_ids, load_ignored, pack_ignored, wordless

CORPUS = {
    "lines": [
        # Two lines sharing one file, as 1,076 real ones do.
        {"lineId": "g:shared:m", "fileName": "m-shared"},
        {"lineId": "g:shared:f", "fileName": "f-shared"},
        {"lineId": "g:tally", "fileName": "tally"},
        {"lineId": "g:tally-twin", "fileName": "tally"},
        {"lineId": "q:5:accept", "fileName": "5-accept"},
    ],
}


def _write(tmp_path, entries):
    path = tmp_path / "ignored.json"
    path.write_text(json.dumps({"version": 1, "exportedAt": "2026-08-16T00:00:00Z",
                                "ignored": entries}))
    return str(path)


def test_missing_file_ignores_nothing(tmp_path):
    # The everyday case: a checkout that has never exported one.
    assert load_ignored(str(tmp_path / "nope.json")) == {}


def test_reads_the_reason_beside_the_line(tmp_path):
    path = _write(tmp_path, [{"lineId": "g:tally", "reason": "war-effort tally"}])

    assert load_ignored(path) == {"g:tally": "war-effort tally"}
    assert ignored_line_ids(path) == {"g:tally"}


def test_a_file_is_ignored_only_when_every_line_addressing_it_is(tmp_path):
    # g:tally and g:tally-twin share tally.mp3; ignoring one of them must not disown the
    # audio the other still needs.
    ignored = {"g:tally": "war-effort tally"}
    assert ignored_files(CORPUS, ignored) == []

    ignored["g:tally-twin"] = "war-effort tally"
    assert ignored_files(CORPUS, ignored) == ["gossip/f-tally.mp3", "gossip/m-tally.mp3",
                                              "gossip/tally.mp3"]


def test_gendered_variants_are_separate_files(tmp_path):
    # m-shared and f-shared are two files, so ignoring one ignores one.
    assert ignored_files(CORPUS, {"g:shared:m": "broken"}) == ["gossip/m-shared.mp3"]


def test_an_unknown_line_id_names_no_file(tmp_path):
    # A stale export naming a line the corpus no longer has excludes nothing, rather than
    # tripping over a missing key mid-rsync.
    assert ignored_files(CORPUS, {"q:9999:accept": "gone"}) == []


def test_files_come_back_sorted(tmp_path):
    ignored = {"q:5:accept": "broken", "g:shared:m": "broken"}
    assert ignored_files(CORPUS, ignored) == ["gossip/m-shared.mp3", "quests/5-accept.mp3",
                                              "quests/f-5-accept.mp3", "quests/m-5-accept.mp3"]


def test_a_moments_file_goes_in_every_form_a_language_may_give_it(tmp_path):
    # A language's own text may make English's two lines one, or its one line two.
    assert "gossip/shared.mp3" not in ignored_files(CORPUS, {"g:shared:m": "broken"})
    assert ignored_files(CORPUS, {"g:shared:m": "broken", "g:shared:f": "broken"}) == [
        "gossip/f-shared.mp3", "gossip/m-shared.mp3", "gossip/shared.mp3"]


def _quest_line(quest_id, source, text="Words.", title="A Quest"):
    return {"lineId": f"q:{quest_id}:{source}", "source": source, "questId": quest_id,
            "questTitle": title, "fileName": f"{quest_id}-{source}", "originalText": text}


DEAD = {"lines": [
    _quest_line(5, "accept"),
    _quest_line(1155, "accept", "x", "<NYI> <TXT> bug crystal side quest"),
    _quest_line(620, "accept"),
    _quest_line(620, "complete"),
    _quest_line(3646, "accept", "\n"),
    _quest_line(3646, "complete"),
    {"lineId": "f:4377:human-male-standard", "source": "followup", "questId": 620,
     "questTitle": "A Quest", "fileName": "4377-human-male-standard", "originalText": "Thanks."},
]}


def test_the_pack_drops_the_quests_the_compendium_leaves_out():
    ignored = pack_ignored(DEAD, {}, removed={620})

    assert {"q:1155:accept", "q:620:accept", "q:620:complete"} <= set(ignored)
    assert ignored["q:620:accept"] == "a quest the Compendium leaves out"
    assert "q:5:accept" not in ignored
    # Said in chat, not on the quest's page: the Compendium's rule does not reach it.
    assert "f:4377:human-male-standard" not in ignored


def test_a_line_with_no_words_is_wordless_but_not_ignored():
    # Its giver is still the quest log's, for the hand-in that has words.
    assert wordless(DEAD) == {"q:3646:accept": "no words to say"}
    assert "q:3646:accept" not in pack_ignored(DEAD, {})


def test_the_pack_keeps_line_ignore_s_own_reason():
    assert pack_ignored(DEAD, {"q:620:accept": "dead"}, removed={620})["q:620:accept"] == "dead"
