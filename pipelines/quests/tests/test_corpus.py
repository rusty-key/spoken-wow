import gzip
import json

import pytest

# The extraction path hands build_corpus a real DataFrame, so these cases build one too rather
# than a stand-in carrying a to_dict method -- the dtypes are half of what build_corpus has to
# survive.
#
# Skipped rather than imported, because pandas is not installed on a normal checkout: it lives
# in requirements-extract.txt with the rest of the corpus refresh, and the pin there (1.5.3)
# has no wheel for this project's Python and does not build from source on it. A missing import
# at collection time fails the entire run before any other module is collected, which is how
# one absent package came to report the whole suite as broken.
pd = pytest.importorskip("pandas")

from tts_cli.corpus import build_corpus, load_corpus, lines_in_area, write_corpus

ROWS = [
    # ordinary quest line
    {"quest": "5", "source": "accept", "quest_title": "Growling Gut", "name": "Jitters",
     "type": "creature", "id": 288, "race": "human", "gender": "male",
     "voice_name": "human-male-standard", "flavor": "standard",
     "player_gender": None, "cleanedText": "Hello there.",
     "text": "Hello there.", "original_text": "Hello there.",
     "templateText_race_gender_hash": "deadbeef"},
    # progress text, voiced like any other line
    {"quest": "7", "source": "progress", "quest_title": "Growling Gut", "name": "Jitters",
     "type": "creature", "id": 288, "race": "human", "gender": "male",
     "voice_name": "human-male-standard", "flavor": "standard",
     "player_gender": None, "cleanedText": "Still waiting.",
     "text": "Still waiting.", "original_text": "Still waiting.",
     "templateText_race_gender_hash": "deadbeef"},
    # unresolved template token
    {"quest": "9", "source": "accept", "quest_title": "Broken", "name": "Jitters",
     "type": "creature", "id": 288, "race": "human", "gender": "male",
     "voice_name": "human-male-standard", "flavor": "standard",
     "player_gender": None, "cleanedText": "Hi $N.",
     "text": "Hi $N.", "original_text": "Hi $N.",
     "templateText_race_gender_hash": "deadbeef"},
    # gossip line for a different NPC
    {"quest": "", "source": "gossip", "quest_title": "", "name": "Guard",
     "type": "creature", "id": 68, "race": "human", "gender": "male",
     "voice_name": "human-male-standard", "flavor": "standard",
     "player_gender": None, "cleanedText": "Move along.",
     "text": "Move along.", "original_text": "Move along.",
     "templateText_race_gender_hash": "abc123"},
]

SPAWNS = [
    ("creature", 288, 0, -9465.5, 74.0),
    ("creature", 288, 0, -9000.0, 100.0),   # same NPC, second spawn
    ("creature", 68, 0, -8900.0, 500.0),
    ("creature", 999, 1, 100.0, 100.0),     # NPC with no voicelines
]

# creature and gameobject IDs are separate spaces that overlap in practice.
COLLIDING_ROWS = ROWS + [
    {"quest": "", "source": "gossip", "quest_title": "", "name": "Wanted Poster",
     "type": "gameobject", "id": 68, "race": "narrator", "gender": "male",
     "voice_name": "narrator-male", "flavor": None,
     "player_gender": None, "cleanedText": "WANTED",
     "text": "WANTED", "original_text": "WANTED",
     "templateText_race_gender_hash": "poster1"},
]


def test_line_ids_and_order():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    assert [l["lineId"] for l in corpus["lines"]] == [
        "q:5:accept", "q:7:progress", "q:9:accept", "g:abc123"]


def test_carries_filenames_from_the_naming_module():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    by_id = {l["lineId"]: l for l in corpus["lines"]}
    assert by_id["q:5:accept"]["fileName"] == "5-accept"
    assert by_id["g:abc123"]["fileName"] == "abc123"


def test_marks_lines_the_generator_skips():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    by_id = {l["lineId"]: l for l in corpus["lines"]}
    assert by_id["q:5:accept"]["generatable"] is True
    assert by_id["q:5:accept"]["skipReason"] is None
    assert by_id["q:7:progress"]["generatable"] is True
    assert by_id["q:7:progress"]["skipReason"] is None
    assert by_id["q:9:accept"]["skipReason"] == "invalid-chars"


def test_carries_no_audio_state():
    """Audio presence belongs to the store, not the corpus - otherwise the committed
    corpus would churn every time a line is regenerated."""
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    assert "hasAudio" not in corpus["lines"][0]
    assert "durationSec" not in corpus["lines"][0]


def test_keeps_every_spawn_for_an_npc():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    assert len(corpus["spawns"]["creature:288"]) == 2


def test_drops_spawns_for_npcs_with_no_lines():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    assert "creature:999" not in corpus["spawns"]


def test_gameobject_does_not_inherit_a_creature_spawn_with_the_same_id():
    """Regression: gameobject 68 is a Wanted Poster, creature 68 a Stormwind City Guard.
    Keying spawns on the bare ID put the poster wherever the guard stood."""
    corpus = build_corpus(pd.DataFrame(COLLIDING_ROWS), SPAWNS)
    assert "gameobject:68" not in corpus["spawns"]

    hits = lines_in_area(corpus, map_id=0, x_range=(-9000, -8800), y_range=(400, 600))
    assert {l["npcType"] for l in hits} == {"creature"}
    assert all(l["npcName"] != "Wanted Poster" for l in hits)


def test_is_json_serializable():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    json.dumps(corpus)  # numpy int64 would raise
    assert isinstance(corpus["lines"][0]["npcId"], int)


def test_round_trips_through_gzip(tmp_path):
    path = tmp_path / "corpus.json.gz"
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    write_corpus(str(path), corpus)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        json.load(f)
    assert load_corpus(str(path))["lineCount"] == 4


def test_area_filter_finds_npcs_spawned_in_the_box():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    hits = lines_in_area(corpus, map_id=0, x_range=(-9500, -9400), y_range=(0, 100))
    assert {l["npcId"] for l in hits} == {288}


def test_area_filter_matches_when_any_spawn_is_inside():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    hits = lines_in_area(corpus, map_id=0, x_range=(-9100, -8800), y_range=(0, 600))
    assert {l["npcId"] for l in hits} == {288, 68}


def test_area_filter_respects_the_map():
    corpus = build_corpus(pd.DataFrame(ROWS), SPAWNS)
    assert lines_in_area(corpus, map_id=1, x_range=(-10000, 0), y_range=(-10000, 10000)) == []
