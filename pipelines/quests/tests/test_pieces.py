"""Sentence pieces: a pack cut at its full stops plays the same line, in pieces that resume."""
import hashlib
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
