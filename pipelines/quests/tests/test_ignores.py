import json

from tts_cli.ignores import ignored_files, ignored_line_ids, load_ignored

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
