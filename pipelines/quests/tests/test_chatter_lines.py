"""What NPCs say out loud in the world: the corpus's chatter rows, named, packed and exported for
the addon's NPC Chat (tts_cli/chatter_lines.py)."""
from tts_cli.chatter_lines import chatter_lines, render
from tts_cli.factions import pack_of_line
from tts_cli.naming import filename_for_row, line_id_for_row, subfolder_from_line_id


def line(line_id, npc_id=10, name="Town Guard", text="Halt, $n!", source="chatter", npc_type="creature"):
    return {"lineId": line_id, "source": source, "questId": None, "npcId": npc_id, "npcName": name,
            "npcType": npc_type, "originalText": text}


def test_a_chat_line_is_named_as_a_follow_up_line_is():
    row = {"source": "chatter", "broadcast_text_id": 100.0, "voice_name": "human-male-standard",
           "quest": None, "player_gender": None}
    assert line_id_for_row(row) == "f:100:human-male-standard"
    assert filename_for_row(row) == "100-human-male-standard"
    assert subfolder_from_line_id(line_id_for_row(row)) == "followup"


def test_a_chat_line_ships_in_the_gossip_pack():
    assert pack_of_line(line("f:100:human-male-standard"), {}) == "gossip"


def test_a_line_is_kept_once_per_speaker_whatever_its_voices():
    corpus = {"lines": [
        line("f:101:human-male-standard", text="Move  along."),
        line("f:100:human-male-standard"),
        line("f:100:human-male-standard~dwarf-male-standard"),
        line("f:100:human-male-standard", npc_id=11, name="Other  Guard"),
    ]}
    assert chatter_lines(corpus) == {
        10: {"name": "Town Guard", "lines": [(100, "Halt, $n!"), (101, "Move along.")]},
        11: {"name": "Other Guard", "lines": [(100, "Halt, $n!")]},
    }


def test_only_chatter_from_creatures_is_exported():
    corpus = {"lines": [
        line("f:100:human-male-standard", source="followup"),
        line("g:abc", source="gossip"),
        line("f:102:narrator-male", npc_type="gameobject"),
    ]}
    assert chatter_lines(corpus) == {}


def test_the_file_names_each_speaker_beside_its_lines():
    text = render({10: {"name": 'The "Guard"', "lines": [(100, "Halt!")]}})
    assert text.startswith("setfenv(1, VoiceOver)\n")
    assert '[10] = { name = "The \\"Guard\\"",' in text
    assert '{ id = 100, text = "Halt!" },' in text
    assert text.endswith("}\n")
