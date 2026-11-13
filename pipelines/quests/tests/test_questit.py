"""QuestIT matching: the hash has to be the addon's exactly, or nothing matches.

The expected hashes are QuestIT 0.8.6's own enHash values for these English texts.
"""
from tts_cli.questit import (Hasher, match_by_hash, match_quest_line, quest_candidates,
                             speak_npc_gender)

NAMES = {
    "classes": ["Paladin", "Warlock", "Warrior", "Hunter", "Priest", "Shaman", "Druid", "Rogue", "Mage"],
    "races": ["Night Elf", "Tauren", "Undead", "Dwarf", "Gnome", "Human", "Troll", "Orc"],
}
HASHER = Hasher(NAMES)

# q:60 accept, as the corpus stores it: $G and $B unresolved, double spaces and all.
CANDLES = ("Hello, $ggood sir:my lady;!  Do you have a moment?$B$BMy brother and I run an "
           "apothecary in Stormwind, and I'm here to gather large candles for their wax.  Can "
           "you help me?$B$BYou can get large candles from kobolds, and I hear rumors that "
           "kobolds are infesting the Elwynn mines ... the Fargodeep mine to the south and "
           "Jasperlode Mine to the east.  I suggest looking for candles in one of those places.")


class TestHash:
    def test_a_title_hashes_as_the_addon_does(self):
        assert HASHER.hash("Sharptalon's Claw") == "919c763f"
        assert HASHER.hash("Jitters' Growling Gut") == "dd90a74f"

    def test_a_gendered_line_hashes_once_per_gender(self):
        assert HASHER.hashes(CANDLES) == {"87b5f3e1", "3a911fc8"}

    def test_a_split_line_hashes_as_its_own_gender_only(self):
        assert len(HASHER.hashes(CANDLES, "m")) == 1
        assert HASHER.hashes(CANDLES, "m") | HASHER.hashes(CANDLES, "f") == {"87b5f3e1", "3a911fc8"}

    def test_a_spelled_out_class_is_the_token(self):
        # The client shows the reader's class where the template says $C; QuestIT folds every
        # class name back to the token, so the template and the screen agree.
        assert HASHER.hash("Greetings, Mage.") == HASHER.hash("Greetings, $c.")
        assert HASHER.hash("Greetings, $C.") == HASHER.hash("Greetings, $c.")

    def test_only_whole_words_are_names(self):
        assert HASHER.hash("Greetings, damage.") != HASHER.hash("Greetings, da$c.")

    def test_trailing_whitespace_does_not_count(self):
        assert HASHER.hash("Hello.\n\n") == HASHER.hash("Hello.")


class TestQuestMatching:
    ENTRY = {
        "title": {"it": "Candele dei kobold", "enHash": "6a56c7cf"},
        "text": {"it": "Salve, $Gbuon signore:buona signora;!", "enHash": ["87b5f3e1", "3a911fc8"]},
        "reward": {"it": "Grazie.", "enHash": "00000000"},
    }

    def test_a_field_whose_english_matches_is_its_translation(self):
        assert match_quest_line(HASHER, self.ENTRY, "accept", CANDLES, "f") == (
            "Salve, $Gbuon signore:buona signora;!", "matched")

    def test_a_field_translated_from_other_english_is_left_out(self):
        assert match_quest_line(HASHER, self.ENTRY, "complete", "Thanks.", None) == (None, "changed")

    def test_a_field_quest_it_does_not_have(self):
        assert match_quest_line(HASHER, self.ENTRY, "progress", "Well?", None) == (None, "untranslated")
        assert match_quest_line(HASHER, None, "accept", CANDLES, None) == (None, "untranslated")

    def test_variants_of_a_field_are_tried_after_it(self):
        entry = {"text": {"it": "a"}, "text#3": {"it": "c"}, "text#2": {"it": "b"}, "reward": {"it": "x"}}
        assert [c["it"] for c in quest_candidates(entry, "text")] == ["a", "b", "c"]


class TestByHash:
    def test_gossip_is_found_by_the_hash_of_its_english(self):
        table = {HASHER.hash("Greetings, $c."): {"it": "Salve, $C."}}
        assert match_by_hash(HASHER, table, "Greetings, $C.") == "Salve, $C."
        assert match_by_hash(HASHER, table, "Farewell.") is None


class TestNpcGender:
    def test_the_speakers_gender_decides(self):
        assert speak_npc_gender("Sono $Pcontento:contenta;.", "female") == "Sono contenta."
        assert speak_npc_gender("Sono $Pcontento:contenta;.", "male") == "Sono contento."

    def test_an_unknown_speaker_takes_the_male_form(self):
        assert speak_npc_gender("Sono $Pcontento:contenta;.", None) == "Sono contento."
