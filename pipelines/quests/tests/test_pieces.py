"""Sentence pieces: a pack cut at its full stops plays the same line, in pieces that resume."""
import gzip
import hashlib
import json
import os
import shutil
import subprocess

import pytest

from tts_cli import pieces

HAVE_FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg and ffprobe")


class TestChooseCuts:
    def test_a_cut_goes_in_the_middle_of_each_pause(self):
        assert pieces.choose_cuts([(3.0, 3.6), (8.0, 8.5)], 12.0) == [3.3, 8.25]

    def test_a_short_sentence_stays_with_the_next(self):
        # 1.0 s into the line is too soon for a piece; the pause at 5 s is the first cut.
        assert pieces.choose_cuts([(0.8, 1.2), (5.0, 5.6)], 10.0) == [5.3]

    def test_a_short_tail_stays_on_the_piece_before(self):
        assert pieces.choose_cuts([(4.0, 4.6), (9.0, 9.5)], 10.0) == [4.3]

    def test_a_line_without_pauses_is_not_cut(self):
        assert pieces.choose_cuts([], 30.0) == []


class TestLongPieces:
    def test_a_piece_too_long_is_cut_again_at_its_longest_shorter_pause(self):
        pauses = [(3.0, 3.6), (8.0, 8.3), (14.0, 14.35), (20.0, 20.3)]
        assert pieces.choose_cuts(pauses, 25.0, min_pause=0.45, max_piece=12, fallback_pause=0.25) == [3.3, 14.175]

    def test_short_pauses_alone_are_not_sentence_ends(self):
        assert pieces.choose_cuts([(4.0, 4.3)], 10.0, min_pause=0.45, max_piece=12, fallback_pause=0.25) == []

    def test_the_second_cut_can_be_turned_off(self):
        pauses = [(3.0, 3.6), (14.0, 14.35)]
        assert pieces.choose_cuts(pauses, 25.0, min_pause=0.45, max_piece=12, fallback_pause=0) == [3.3]


class TestSentenceStarts:
    def test_a_sentence_starts_after_a_full_stop_question_or_exclamation(self):
        assert pieces.sentence_starts("One two. Three four? Five six! Seven")[0] == [2, 4, 6]

    def test_an_abbreviation_or_an_initial_ends_no_sentence(self):
        assert pieces.sentence_starts("Ask Mr. Smith and J. Doe. Then go")[0] == [6]

    def test_an_ellipsis_before_a_lower_case_word_is_inside_its_sentence(self):
        assert pieces.sentence_starts("I think... maybe not. Go")[0] == [4]

    def test_a_paragraph_starts_a_sentence_whatever_ends_the_one_before(self):
        assert pieces.sentence_starts("Hear me\n\nfriend")[0] == [2]

    def test_quotes_around_a_stop_or_a_word_are_looked_through(self):
        assert pieces.sentence_starts('He said "Go." "Wait," she cried')[0] == [3]

    def test_commas_semicolons_colons_and_dashes_start_clauses(self):
        assert pieces.sentence_starts("One, two; three: four \u2014 five")[1] == [1, 2, 3, 5]


SAID = "One two three. Four five six. Seven eight nine."
SAID_TIMES = [0, .5, 1, 2.5, 3, 3.5, 5, 5.5, 6]


class TestTimedCuts:
    def test_a_cut_goes_just_before_each_sentences_first_word(self):
        lead = pieces.WORD_LEAD
        assert pieces.choose_timed_cuts(SAID, SAID_TIMES, 7.5) == [round(2.5 - lead, 3), round(5 - lead, 3)]

    def test_a_cut_never_falls_nearer_the_word_before_than_halfway(self):
        assert pieces.choose_timed_cuts("One. Two", [0, .3], 1.0, min_piece=0, min_tail=0) == [0.15]

    def test_a_short_sentence_stays_with_the_next(self):
        assert pieces.choose_timed_cuts(SAID, [0, .3, .6, 1, 1.3, 1.6, 5, 5.5, 6], 7.5) == [round(5 - pieces.WORD_LEAD, 3)]

    def test_times_that_do_not_fit_the_text_measure_the_line_instead(self):
        assert pieces.choose_timed_cuts(SAID, SAID_TIMES[:-1], 7.5) is None
        assert pieces.choose_timed_cuts(SAID, [0, .5, 1, 2.5, 2, 3.5, 5, 5.5, 6], 7.5) is None
        assert pieces.choose_timed_cuts(SAID, SAID_TIMES, 6.0) is None
        assert pieces.choose_timed_cuts("", [], 6.0) is None

    def test_a_piece_too_long_is_cut_at_the_clause_whose_words_are_furthest_apart(self):
        # Two clauses would each do: the one at 9.5 s is nearer the middle, but the pause before the
        # one at 11.5 s is longer, as its words' starts 1.5 s apart say.
        words = [f"w{i}," if i in (9, 11) else f"w{i}" for i in range(20)]
        times = [*range(10), 9.75, 10.25, 11.75, *[12.5 + i for i in range(7)]]
        assert pieces.choose_timed_cuts(" ".join(words), times, 20.0, max_piece=12) == [11.5]
        assert pieces.choose_timed_cuts(" ".join(words), times, 20.0, max_piece=12, cut_clauses=False) == []


TIMES_TABLE = ('if not VoiceOver or not VoiceOver.DataModules then return end\n'
               'SpokenQuestsAudioTest.WordTimesByFileName = {\n'
               '    ["2-accept"] = "0 .5 1 2.5 3 3.5 5 5.5 6",\n'
               '    ["f-3-complete"] = "0 .4",\n'
               '}\n')


def _corpus(path, lines):
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump({"lines": [{"fileName": name, "text": text} for name, text in lines]}, f)
    return str(path)


class TestWordTimesAndText:
    def test_the_pack_table_reads_as_seconds_by_line(self):
        assert pieces.parse_word_times(TIMES_TABLE) == {"2-accept": SAID_TIMES, "f-3-complete": [0, .4]}

    def test_a_name_two_texts_share_is_left_out(self, tmp_path):
        corpus = _corpus(tmp_path / "c.json.gz", [("2-accept", SAID), ("2-accept", SAID),
                                                  ("4-accept", "One."), ("4-accept", "Another.")])
        assert pieces.load_texts(corpus) == {"2-accept": SAID}

    def test_a_line_is_timed_where_the_pack_has_its_times_and_the_corpus_its_text(self, tmp_path):
        (tmp_path / "generated").mkdir()
        (tmp_path / "generated" / pieces.WORD_TIMES_FILE).write_text(TIMES_TABLE)
        corpus = _corpus(tmp_path / "c.json.gz", [("2-accept", SAID), ("9-accept", "Nine.")])
        assert pieces.timed_lines(str(tmp_path), TOC, corpus) == {"2-accept": (SAID, SAID_TIMES)}
        english = f"## {pieces.LANGUAGE_KEY}: enUS\n" + TOC
        assert pieces.timed_lines(str(tmp_path), english, corpus) == {"2-accept": (SAID, SAID_TIMES)}

    def test_a_pack_in_another_language_is_measured(self, tmp_path):
        (tmp_path / "generated").mkdir()
        (tmp_path / "generated" / pieces.WORD_TIMES_FILE).write_text(TIMES_TABLE)
        corpus = _corpus(tmp_path / "c.json.gz", [("2-accept", SAID)])
        assert pieces.timed_lines(str(tmp_path), f"## {pieces.LANGUAGE_KEY}: deDE\n" + TOC, corpus) == {}


class TestPackLengths:
    def test_lengths_pack_as_word_times_do(self):
        assert pieces.pack_lengths([3.44, 0.5, 12.0, 2.105]) == "3.44 .5 12 2.1"


class TestParseSilences:
    def test_a_pause_still_open_at_the_end_is_dropped(self):
        log = ("[silencedetect @ 0x1] silence_start: 3.1\n"
               "[silencedetect @ 0x1] silence_end: 3.7 | silence_duration: 0.6\n"
               "[silencedetect @ 0x1] silence_start: 9.9\n")
        assert pieces.parse_silences(log) == [(3.1, 3.7)]

    def test_a_pause_at_the_very_start_is_clamped_to_zero(self):
        log = "silence_start: -0.01\nsilence_end: 0.5 | silence_duration: 0.51\n"
        assert pieces.parse_silences(log) == [(0.0, 0.5)]


TOC = ("## Interface: 11509, 20506, 16001\n## Title: Test\n## Version: 2.5.0\n\nModule.lua\n\n"
       "generated\\sound_length_table.lua\ngenerated\\word_times_table.lua\n")


class TestPatchToc:
    def test_the_table_loads_after_the_lengths_and_the_pack_is_marked(self, tmp_path):
        toc = tmp_path / "X.toc"
        toc.write_text(TOC)
        pieces.patch_toc(str(toc))
        lines = toc.read_text().split("\n")
        assert lines[lines.index("generated\\sound_length_table.lua") + 1] == "generated\\sound_pieces_table.lua"
        assert lines[lines.index("## Version: 2.5.0") + 1] == pieces.TOC_MARKER

    def test_windows_line_endings_are_kept_and_a_second_patch_changes_nothing(self, tmp_path):
        toc = tmp_path / "X.toc"
        toc.write_bytes(TOC.replace("\n", "\r\n").encode())
        pieces.patch_toc(str(toc))
        once = toc.read_bytes()
        pieces.patch_toc(str(toc))
        assert toc.read_bytes() == once
        assert b"\r\ngenerated\\sound_pieces_table.lua\r\n" in once
        assert b"\n" not in once.replace(b"\r\n", b"")


def _speech(path, parts):
    """An Ogg Vorbis stand-in for a take: tones for words, digital silence for pauses."""
    inputs, labels = [], []
    for i, (kind, seconds) in enumerate(parts):
        source = f"sine=frequency=220:sample_rate=44100:duration={seconds}" if kind == "tone" \
            else f"anullsrc=r=44100:cl=mono:d={seconds}"
        inputs += ["-f", "lavfi", "-i", source]
        labels.append(f"[{i}:a]")
    graph = "".join(labels) + f"concat=n={len(parts)}:v=0:a=1,aformat=channel_layouts=mono[out]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]",
                    "-c:a", "libvorbis", "-q:a", "0", str(path)], check=True)


def _duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=start_time",
                          "-of", "default=nw=1", str(path)], capture_output=True, text=True, check=True).stdout
    values = dict(line.split("=") for line in out.split())
    return float(values["duration"]), float(values["start_time"])


def _tree_digest(root):
    digest = hashlib.sha256()
    for folder, _, files in sorted(os.walk(root)):
        for name in sorted(files):
            path = os.path.join(folder, name)
            digest.update(os.path.relpath(path, root).encode())
            with open(path, "rb") as f:
                digest.update(f.read())
    return digest.hexdigest()


@pytest.fixture
def pack(tmp_path):
    root = tmp_path / "SpokenQuestsAudioTest"
    (root / "generated" / "sounds" / "quests").mkdir(parents=True)
    (root / "generated" / "sounds" / "gossip").mkdir(parents=True)
    (root / "SpokenQuestsAudioTest.toc").write_text(TOC)
    (root / "Module.lua").write_text("SpokenQuestsAudioTest = {}\n")
    (root / "generated" / "sound_length_table.lua").write_text("-- lengths\n")
    (root / "generated" / "word_times_table.lua").write_text("-- times\n")
    # Three sentences, with a comma's pause inside the second that must not be cut.
    _speech(root / "generated" / "sounds" / "quests" / "1-accept.ogg",
            [("tone", 3.0), ("quiet", 0.6), ("tone", 2.5), ("quiet", 0.25), ("tone", 2.0),
             ("quiet", 0.6), ("tone", 3.0)])
    _speech(root / "generated" / "sounds" / "gossip" / "g-short.ogg", [("tone", 1.5)])
    return root


@needs_ffmpeg
class TestConvertPack:
    def test_a_line_becomes_a_folder_of_pieces_and_a_row(self, pack, tmp_path):
        before = _tree_digest(pack)
        results = pieces.convert_pack(str(pack), str(tmp_path / "out"))
        out = tmp_path / "out" / pack.name

        folder = out / "generated" / "sounds" / "quests" / "1-accept"
        assert sorted(os.listdir(folder)) == ["01.ogg", "02.ogg", "03.ogg"]
        assert not (out / "generated" / "sounds" / "quests" / "1-accept.ogg").exists()
        assert (out / "generated" / "sounds" / "gossip" / "g-short.ogg").exists()
        assert (out / "Module.lua").exists() and (out / "generated" / "word_times_table.lua").exists()

        line = next(r for r in results if r.name == "1-accept")
        whole, _ = _duration(pack / "generated" / "sounds" / "quests" / "1-accept.ogg")
        assert sum(line.lengths) == pytest.approx(whole, abs=0.1)
        for name, length in zip(sorted(os.listdir(folder)), line.lengths):
            duration, start = _duration(folder / name)
            assert duration == pytest.approx(length, abs=0.05)
            assert start == pytest.approx(0.0, abs=0.01)

        table = (out / "generated" / pieces.TABLE_FILE).read_text()
        assert f'SpokenQuestsAudioTest.{pieces.TABLE_NAME} = {{' in table
        assert f'["1-accept"] = "{pieces.pack_lengths(line.lengths)}",' in table
        assert "g-short" not in table
        assert pieces.TOC_MARKER in (out / f"{pack.name}.toc").read_text()
        assert _tree_digest(pack) == before

    def test_two_runs_write_the_same_bytes(self, pack, tmp_path):
        pieces.convert_pack(str(pack), str(tmp_path / "a"))
        pieces.convert_pack(str(pack), str(tmp_path / "b"))
        assert _tree_digest(tmp_path / "a") == _tree_digest(tmp_path / "b")

    def test_an_existing_output_is_never_overwritten(self, pack, tmp_path):
        (tmp_path / "out" / pack.name).mkdir(parents=True)
        with pytest.raises(FileExistsError):
            pieces.convert_pack(str(pack), str(tmp_path / "out"))

    def test_a_converted_pack_is_not_converted_again(self, pack, tmp_path):
        pieces.convert_pack(str(pack), str(tmp_path / "once"))
        with pytest.raises(ValueError, match="already converted"):
            pieces.convert_pack(str(tmp_path / "once" / pack.name), str(tmp_path / "twice"))

    def test_a_dry_run_writes_nothing(self, pack, tmp_path):
        results = pieces.convert_pack(str(pack), str(tmp_path / "out"), dry_run=True)
        assert not (tmp_path / "out").exists()
        assert [len(r.lengths) for r in results] == [1, 3]

    def test_encode_mode_also_cuts_at_the_sentences(self, pack, tmp_path):
        results = pieces.convert_pack(str(pack), str(tmp_path / "out"), pieces.Settings(mode="encode"))
        assert [len(r.lengths) for r in results] == [1, 3]


@pytest.fixture
def timed_pack(pack, tmp_path):
    """The pack, with a line spoken without a pause anywhere, and its word times and text."""
    _speech(pack / "generated" / "sounds" / "quests" / "2-accept.ogg", [("tone", 7.5)])
    (pack / "generated" / pieces.WORD_TIMES_FILE).write_text(TIMES_TABLE)
    corpus = _corpus(tmp_path / "corpus.json.gz", [("2-accept", SAID), ("1-accept", "Too few words.")])
    return pack, corpus


@needs_ffmpeg
class TestTimedPack:
    def test_a_line_with_word_times_is_cut_at_its_sentences_without_a_pause_to_find(self, timed_pack, tmp_path):
        pack, corpus = timed_pack
        results = pieces.convert_pack(str(pack), str(tmp_path / "out"), corpus=corpus)
        line = next(r for r in results if r.name == "2-accept")
        assert line.method == "times"
        folder = tmp_path / "out" / pack.name / "generated" / "sounds" / "quests" / "2-accept"
        assert sorted(os.listdir(folder)) == ["01.ogg", "02.ogg", "03.ogg"]
        lead = pieces.WORD_LEAD
        assert line.lengths == pytest.approx([2.5 - lead, 2.5, 2.5 + lead], abs=0.05)
        assert pieces.summarise(results)["lines_timed"] == 1

    def test_a_line_whose_times_do_not_fit_its_text_is_measured(self, timed_pack, tmp_path):
        pack, corpus = timed_pack
        table = TIMES_TABLE.replace('}\n', '    ["1-accept"] = "0 .5",\n}\n')
        (pack / "generated" / pieces.WORD_TIMES_FILE).write_text(table)
        results = pieces.convert_pack(str(pack), str(tmp_path / "out"), corpus=corpus)
        line = next(r for r in results if r.name == "1-accept")
        assert line.method == "pauses" and len(line.lengths) == 3

    def test_without_a_corpus_every_line_is_measured(self, timed_pack, tmp_path):
        pack, _ = timed_pack
        results = pieces.convert_pack(str(pack), str(tmp_path / "out"), corpus=None)
        assert {r.method for r in results} == {"pauses"}
        assert len(next(r for r in results if r.name == "2-accept").lengths) == 1

    def test_a_dry_run_cuts_where_the_run_does(self, timed_pack, tmp_path):
        pack, corpus = timed_pack
        dry = pieces.convert_pack(str(pack), str(tmp_path / "out"), dry_run=True, corpus=corpus)
        lead = pieces.WORD_LEAD
        assert next(r for r in dry if r.name == "2-accept").lengths == pytest.approx([2.5 - lead, 2.5, 2.5 + lead],
                                                                                      abs=0.05)


LOOKUP = '''local ADDON_NAME = ...

local pack = {
	version = 1,
	zones = {
		[947] = { file = "947\\\\zone", len = 13.2, times = "0 .4 .88" },
		[948] = { file = "948\\\\zone", len = 1.5 },
	},
}
'''


@pytest.fixture
def lookup_pack(tmp_path):
    root = tmp_path / "SpokenPlacesAudio"
    (root / "Data").mkdir(parents=True)
    (root / "Sounds" / "947").mkdir(parents=True)
    (root / "Sounds" / "948").mkdir(parents=True)
    (root / "SpokenPlacesAudio.toc").write_text("## Interface: 11509\n## Title: Places\n\nData/Sounds.lua\n")
    (root / "Data" / "Sounds.lua").write_text(LOOKUP)
    parts = [("tone", 3.0), ("quiet", 0.6), ("tone", 2.5), ("quiet", 0.6), ("tone", 3.0)]
    for name, spec in (("947/zone.mp3", parts), ("948/zone.mp3", [("tone", 1.5)])):
        ogg = tmp_path / "speech.ogg"
        _speech(ogg, spec)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ogg), "-c:a", "libmp3lame", "-b:a", "128k",
                        str(root / "Sounds" / name)], check=True)
    return root


@needs_ffmpeg
class TestLookupPack:
    def test_a_split_line_gains_pieces_in_its_entry_and_a_folder(self, lookup_pack, tmp_path):
        results = pieces.convert_pack(str(lookup_pack), str(tmp_path / "out"))
        out = tmp_path / "out" / lookup_pack.name
        assert sorted(os.listdir(out / "Sounds" / "947" / "zone")) == ["01.mp3", "02.mp3", "03.mp3"]
        assert not (out / "Sounds" / "947" / "zone.mp3").exists()
        assert (out / "Sounds" / "948" / "zone.mp3").exists()
        line = next(r for r in results if r.name == "947\\zone")
        table = (out / "Data" / "Sounds.lua").read_text()
        assert f'{{ file = "947\\\\zone", len = 13.2, pieces = "{pieces.pack_lengths(line.lengths)}", times = "0 .4 .88" }}' in table
        assert '{ file = "948\\\\zone", len = 1.5 },' in table
        assert pieces.LOOKUP_TOC_MARKER in (out / "SpokenPlacesAudio.toc").read_text()

    def test_a_converted_lookup_pack_is_not_converted_again(self, lookup_pack, tmp_path):
        pieces.convert_pack(str(lookup_pack), str(tmp_path / "once"))
        with pytest.raises(ValueError, match="already converted"):
            pieces.convert_pack(str(tmp_path / "once" / lookup_pack.name), str(tmp_path / "twice"))

    def test_an_entry_it_cannot_read_stops_the_run(self, lookup_pack, tmp_path):
        (lookup_pack / "Data" / "Sounds.lua").write_text(LOOKUP.replace('len = 1.5', 'length = 1.5'))
        with pytest.raises(ValueError, match="entries not written"):
            pieces.convert_pack(str(lookup_pack), str(tmp_path / "out"))
