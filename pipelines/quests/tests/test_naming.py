import pytest

from tts_cli.naming import (
    broadcast_gossip_stem,
    filename_for_row,
    filename_from_line_id,
    followup_stem_from_line_id,
    gossip_hash_from_line_id,
    gossip_stem_rank,
    line_id_for_row,
    localized_gossip_stem,
    split_voice,
    subfolder_from_line_id,
    variant_file_name,
    variant_line_id,
)

QUEST = {"quest": "5", "source": "accept",
         "templateText_race_gender_hash": "deadbeef", "player_gender": None}
QUEST_F = {"quest": "5", "source": "accept",
           "templateText_race_gender_hash": "deadbeef", "player_gender": "f"}
GOSSIP = {"quest": "", "source": "gossip",
          "templateText_race_gender_hash": "abc123", "player_gender": None}
GOSSIP_M = {"quest": "", "source": "gossip",
            "templateText_race_gender_hash": "abc123", "player_gender": "m"}
# A follow-up row carries its quest, and a float id: extract appends it to a DataFrame whose
# other rows have no broadcast_text_id, so pandas stores the column as float64.
FOLLOWUP = {"quest": 54, "source": "followup", "templateText_race_gender_hash": "feedface",
            "broadcast_text_id": 4377.0, "voice_name": "dwarf-male-standard",
            "player_gender": None}
FOLLOWUP_F = {**FOLLOWUP, "player_gender": "f"}


def test_quest_filename():
    assert filename_for_row(QUEST) == "5-accept"


def test_gendered_quest_filename():
    assert filename_for_row(QUEST_F) == "f-5-accept"


def test_gossip_filename_is_the_hash():
    assert filename_for_row(GOSSIP) == "abc123"


def test_gendered_gossip_filename():
    assert filename_for_row(GOSSIP_M) == "m-abc123"


def test_line_ids():
    assert line_id_for_row(QUEST) == "q:5:accept"
    assert line_id_for_row(QUEST_F) == "q:5:accept:f"
    assert line_id_for_row(GOSSIP) == "g:abc123"
    assert line_id_for_row(GOSSIP_M) == "g:abc123:m"


def test_followup_is_named_after_its_words_and_voice_not_its_quest():
    assert filename_for_row(FOLLOWUP) == "4377-dwarf-male-standard"
    assert filename_for_row(FOLLOWUP_F) == "f-4377-dwarf-male-standard"
    assert line_id_for_row(FOLLOWUP) == "f:4377:dwarf-male-standard"
    assert line_id_for_row(FOLLOWUP_F) == "f:4377:dwarf-male-standard:f"


def test_followup_in_a_model_voice():
    # tts_cli.flavors.model_voice: a speaker with no humanoid display is voiced by its model.
    row = {**FOLLOWUP, "broadcast_text_id": 3475.0, "voice_name": "model-29"}
    assert line_id_for_row(row) == "f:3475:model-29"
    assert filename_for_row(row) == "3475-model-29"
    assert filename_for_row({**row, "player_gender": "m"}) == "m-3475-model-29"
    assert filename_from_line_id("f:3475:model-29:f") == "f-3475-model-29"
    assert followup_stem_from_line_id("f:3475:model-29:f") == "3475-model-29"
    assert subfolder_from_line_id("f:3475:model-29") == "followup"


def test_followup_voice_without_a_flavor():
    row = {**FOLLOWUP, "voice_name": "bloodelf-male"}
    assert line_id_for_row(row) == "f:4377:bloodelf-male"
    assert filename_from_line_id(line_id_for_row(row)) == "4377-bloodelf-male"


def test_followup_lookup_stem_drops_the_gender_prefix():
    # The addon adds m-/f- itself, as for a gossip hash.
    assert followup_stem_from_line_id("f:4377:dwarf-male-standard:f") == "4377-dwarf-male-standard"
    with pytest.raises(ValueError):
        followup_stem_from_line_id("g:abc123")


@pytest.mark.parametrize("row", [QUEST, QUEST_F, GOSSIP, GOSSIP_M, FOLLOWUP, FOLLOWUP_F])
def test_line_id_round_trips_to_filename(row):
    assert filename_from_line_id(line_id_for_row(row)) == filename_for_row(row)


def test_subfolder():
    assert subfolder_from_line_id("q:5:accept") == "quests"
    assert subfolder_from_line_id("g:abc123:m") == "gossip"
    assert subfolder_from_line_id("f:4377:dwarf-male-standard") == "followup"


def test_rejects_unknown_line_id():
    with pytest.raises(ValueError):
        filename_from_line_id("x:nonsense")
    with pytest.raises(ValueError):
        subfolder_from_line_id("x:nonsense")


def test_broadcast_and_localized_gossip_stems():
    assert broadcast_gossip_stem(6029.0, "orc-female-standard") == "b6029-orc-female-standard"
    assert localized_gossip_stem("deDE", "0" * 32) == "deDE-" + "0" * 32
    for stem in ("b6029-orc-female-standard", "deDE-" + "0" * 32):
        assert filename_from_line_id(f"g:{stem}") == stem
        assert filename_from_line_id(f"g:{stem}:f") == f"f-{stem}"
        assert gossip_hash_from_line_id(f"g:{stem}:m") == stem
        assert subfolder_from_line_id(f"g:{stem}") == "gossip"


def test_gossip_stem_rank():
    # A hash is hex: it never starts with "b" followed by a dash-holding tail.
    assert gossip_stem_rank("b6029-orc-female-standard") == 0
    assert gossip_stem_rank("bad0c0ffee" + "0" * 22) == 1
    assert gossip_stem_rank("deDE-" + "0" * 32) == 2


# The same vectors as apps/web/src/lib/contributions/naming.test.ts, which mirrors these.
VOICED = [
    ("q:109:accept", "109-accept", "human-male-standard",
     "q:109:accept~human-male-standard", "109-accept-human-male-standard"),
    ("q:109:complete:f", "f-109-complete", "dwarf-female-standard",
     "q:109:complete:f~dwarf-female-standard", "f-109-complete-dwarf-female-standard"),
    ("g:abc123:m", "m-abc123", "human-male-warrior",
     "g:abc123:m~human-male-warrior", "m-abc123-human-male-warrior"),
    ("f:4377:dwarf-male-standard", "4377-dwarf-male-standard", "dwarf-male-grim",
     "f:4377:dwarf-male-standard~dwarf-male-grim", "4377-dwarf-male-standard-dwarf-male-grim"),
]


@pytest.mark.parametrize("line_id,file_name,voice,variant_id,variant_file", VOICED)
def test_a_line_in_another_voice_is_named_after_it(line_id, file_name, voice, variant_id,
                                                   variant_file):
    assert variant_line_id(line_id, voice) == variant_id
    assert variant_file_name(file_name, voice) == variant_file
    assert filename_from_line_id(variant_id) == variant_file
    assert split_voice(variant_id) == (line_id, voice)
    assert split_voice(line_id) == (line_id, None)
    assert subfolder_from_line_id(variant_id) == subfolder_from_line_id(line_id)


def test_the_lookup_stems_of_a_voice_carry_it_without_the_player_gender():
    assert gossip_hash_from_line_id("g:abc123:m~human-male-warrior") == "abc123-human-male-warrior"
    assert followup_stem_from_line_id("f:4377:dwarf-male-standard~dwarf-male-grim") == \
        "4377-dwarf-male-standard-dwarf-male-grim"
