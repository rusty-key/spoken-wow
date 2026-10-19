import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import align  # noqa: E402
import export  # noqa: E402
import current  # noqa: E402
import manifest  # noqa: E402


def heard(*words):
    return [(w, start, start + 0.2) for w, start in words]


def test_words_are_cut_like_the_addon_cuts_them():
    assert align.caption_words("Hello,  there friend\n\nBye") == ["Hello,", "there friend", "Bye"]


def test_a_heard_word_takes_the_models_start_and_a_missed_one_falls_between():
    words = ["Kill", "six", "of", "them."]
    times, matched = align.align_words(words, heard(("Kill", 0.5), ("six", 1.0), ("them", 2.0)), 3.0)
    assert times == [0.5, 1.0, 1.5, 2.0]
    assert matched == 0.75


def test_a_word_heard_as_another_is_read_in_place_when_the_counts_agree():
    times, matched = align.align_words(["a", "gnoll", "b"], heard(("a", 0.1), ("noll", 0.9), ("b", 1.5)), 2.0)
    assert times == [0.1, 0.9, 1.5]
    assert matched == 2 / 3


def test_extra_words_heard_before_the_text_are_ignored():
    # A book page read after its title.
    times, matched = align.align_words(["Only", "a", "few"], heard(("Title", 0.1), ("Only", 1.0), ("a", 1.3), ("few", 1.5)), 2.0)
    assert times == [1.0, 1.3, 1.5]
    assert matched == 1.0


def test_times_never_go_backwards_or_past_the_recording():
    times, _ = align.align_words(["a", "b", "c"], heard(("a", 1.0), ("b", 0.4), ("c", 9.0)), 2.0)
    assert times == sorted(times) and times[-1] <= 2.0


def test_nothing_in_common_gives_no_times():
    times, matched = align.align_words(["a", "b"], heard(("x", 0.1), ("y", 0.5), ("z", 0.9)), 1.0)
    assert times is None and matched == 0.0


def test_encoding_round_trips_to_the_hundredth():
    times = [0.0, 0.31, 0.5, 1.75, 12.0, 40.0]
    assert export.decode(export.encode(times)) == times


def test_a_fixed_string_for_the_lua_side_to_read():
    # tests/lua/word_times_test.lua holds the same pair.
    assert export.encode([0.0, 0.31, 0.5, 1.75]) == "AAAfATB9"
    assert export.encode([0.5, 1.0, 1.5]) == "AyAyAy"


def test_a_gap_too_long_to_hold_is_refused():
    assert export.encode([0.0, 41.0]) is None
    assert export.encode([2.0, 1.0]) is None


def test_each_family_is_kept_and_weak_matches_are_left_out():
    rows = [
        {"family": "quests", "id": "33-accept", "matched": 0.97, "t": [0.5, 1.0]},
        {"family": "zones", "id": "1411\\zone", "matched": 0.9, "t": [0.0, 0.5]},
        {"family": "books", "id": "15", "matched": 0.5, "t": [0.0, 0.5]},
    ]
    kept, skipped = export.select(rows, 0.85)
    assert kept == {"quests": {"33-accept": "AyAy"}, "gossip": {}, "zones": {"1411\\zone": "AAAy"}, "books": {}}
    assert skipped == {"unmatched": 1, "gap": 0}
    text = export.render_lua(kept)
    assert '["33-accept"] = "AyAy",' in text
    assert '["1411\\\\zone"] = "AAAy",' in text
    assert 'Add("gossip"' not in text


def test_a_recording_in_another_voice_has_its_base_lines_words():
    texts = {("quests", "109-accept"): "Kill six.", ("quests", "5-accept"): "Hello."}
    voices = ["human-male-standard", "narrator-male"]
    assert manifest.text_of("quests", "109-accept", texts, voices) == "Kill six."
    assert manifest.text_of("quests", "109-accept-human-male-standard", texts, voices) == "Kill six."
    assert manifest.text_of("quests", "109-accept-narrator-male", texts, voices) == "Kill six."
    assert manifest.text_of("quests", "65593-accept", texts, voices) is None
    assert manifest.text_of("gossip", "109-accept-narrator-male", texts, voices) is None


def test_a_row_is_current_while_its_recording_keeps_its_size(tmp_path):
    clip = tmp_path / "1.mp3"
    clip.write_bytes(b"x" * 100)
    assert current.unchanged({"bytes": 100, "length": 1.0}, str(clip))
    clip.write_bytes(b"x" * 101)
    assert not current.unchanged({"bytes": 100, "length": 1.0}, str(clip))
    assert not current.unchanged({"bytes": 100, "length": 1.0}, str(tmp_path / "gone.mp3"))
    assert not current.unchanged({"bytes": 100, "length": 1.0}, None)


def test_a_whisperx_alignment_keeps_the_words_that_got_a_time():
    aligned = [{"word": "Take", "start": 0.5, "end": 0.7}, {"word": "10", "end": 0.9},
               {"word": "bears,", "start": 1.2, "end": 1.6}]
    assert align.heard_from_alignment(aligned) == [("Take", 0.5, 0.7), ("bears,", 1.2, 1.6)]


def test_a_word_whisperx_could_not_place_falls_between_its_neighbours():
    words = align.caption_words("Take 10 bears,")
    heard = align.heard_from_alignment([{"word": "Take", "start": 0.5, "end": 0.7}, {"word": "10"},
                                        {"word": "bears,", "start": 1.5, "end": 1.9}])
    times, matched = align.align_words(words, heard, 3.0)
    assert times == [0.5, 1.0, 1.5]
    assert abs(matched - 2 / 3) < 1e-9


def test_a_clip_just_generated_is_timed_into_the_packed_form(monkeypatch):
    monkeypatch.setattr(align, "load_whisperx", lambda language="en": (None, "cpu"))
    monkeypatch.setattr(align, "force_align", lambda aligner, device, path, text: (heard(("one", 0.5), ("two", 1.0)), 2.0))
    packed, matched = align.align_clip("take.mp3", "one two")
    assert export.decode(packed) == [0.5, 1.0]
    assert matched == 1.0


def test_a_clip_that_matched_too_little_is_not_timed(monkeypatch):
    monkeypatch.setattr(align, "load_whisperx", lambda language="en": (None, "cpu"))
    monkeypatch.setattr(align, "force_align", lambda aligner, device, path, text: (heard(("x", 0.1), ("y", 0.5)), 1.0))
    assert align.align_clip("take.mp3", "one two") is None
