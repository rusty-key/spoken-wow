import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pack_times  # noqa: E402

BACKSLASH = chr(92)


def quest_pack(tmp_path):
    pack = tmp_path / "SpokenQuestsAudioHorde"
    for folder, name in (("quests", "7-accept"), ("gossip", "abc"), ("quests", "8-accept")):
        sounds = pack / "generated" / "sounds" / folder
        sounds.mkdir(parents=True, exist_ok=True)
        (sounds / (name + ".ogg")).write_bytes(b"x")
    (pack / "SpokenQuestsAudioHorde.toc").write_text("## Title: x\n\nModule.lua\n", encoding="utf8")
    return pack


def test_a_pack_gets_the_times_of_the_recordings_it_holds(tmp_path):
    pack = quest_pack(tmp_path)
    times = {"quests": {"7-accept": "AyAy", "9-accept": "AyAy"}, "gossip": {"abc": "AyAyAy"}}
    assert pack_times.add_to_pack(str(pack), times) == 2
    data = (pack / "Data" / "WordTimes.lua").read_text(encoding="utf8")
    assert '["7-accept"] = "AyAy"' in data and '["abc"] = "AyAyAy"' in data and "9-accept" not in data


def test_the_data_file_is_listed_once_ahead_of_the_pack_s_own_files(tmp_path):
    pack = quest_pack(tmp_path)
    times = {"quests": {"7-accept": "AyAy"}}
    pack_times.add_to_pack(str(pack), times)
    pack_times.add_to_pack(str(pack), times)
    toc = (pack / "SpokenQuestsAudioHorde.toc").read_text(encoding="utf8")
    assert toc.splitlines()[-2:] == ["Data" + BACKSLASH + "WordTimes.lua", "Module.lua"]
    assert toc.count("WordTimes.lua") == 1


def test_a_zones_recording_is_found_by_its_folder_and_name(tmp_path):
    pack = tmp_path / "SpokenZonesAudio"
    (pack / "Sounds" / "1411").mkdir(parents=True)
    (pack / "Sounds" / "1411" / "zone.mp3").write_bytes(b"x")
    assert pack_times.recordings(str(pack)) == [("zones", "1411" + BACKSLASH + "zone")]


def test_a_readables_recording_is_found_by_its_file_name(tmp_path):
    pack = tmp_path / "SpokenBooksAudio"
    (pack / "Sounds").mkdir(parents=True)
    (pack / "Sounds" / "15.mp3").write_bytes(b"x")
    assert pack_times.recordings(str(pack)) == [("books", "15")]


def test_a_pack_with_no_times_is_left_alone(tmp_path):
    pack = tmp_path / "SpokenBooksAudio"
    (pack / "Sounds").mkdir(parents=True)
    (pack / "Sounds" / "15.mp3").write_bytes(b"x")
    (pack / "SpokenBooksAudio.toc").write_text("## Title: x\n", encoding="utf8")
    assert pack_times.add_to_pack(str(pack), {"books": {}}) == 0
    assert not (pack / "Data").exists()
