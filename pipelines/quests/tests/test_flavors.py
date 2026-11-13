from tts_cli.flavors import (apply_fallbacks, consensus_flavor, fallback_flavors, file_key,
                             flavor_from_sound_name, is_model_voice, model_voice, voice_name)


class TestFlavorFromSoundName:
    def test_reads_the_personality_out_of_a_greeting(self):
        assert flavor_from_sound_name("DwarfFemaleMaternalNPCGreetings") == "maternal"

    def test_reads_farewells_and_pissed_too(self):
        assert flavor_from_sound_name("OrcFemaleShamanNPCFarewells") == "shaman"
        assert flavor_from_sound_name("TrollMaleDarkNPCPissed") == "dark"

    def test_strips_the_vendor_suffix(self):
        """Vendor lines are the same actor reading shopkeeper dialogue, not a new voice."""
        assert flavor_from_sound_name("DwarfMaleGrimVendorNPCGreetings") == "grim"

    def test_reads_names_the_database_truncated(self):
        """vmangos stores sound_entries.name cut to 31 characters, which loses the kind."""
        assert flavor_from_sound_name("DwarfMaleStandardVendorNPCGreet") == "standard"
        assert flavor_from_sound_name("NightElfFemalePriestessNPCGreet") == "priestess"

    def test_maps_undead_to_the_internal_race_name(self):
        assert flavor_from_sound_name("UndeadMaleDarkNPCGreetings") == "dark"

    def test_accepts_a_sound_belonging_to_the_npcs_own_race_and_gender(self):
        assert flavor_from_sound_name("OrcFemaleShamanNPCGreetings", "orc-female") == "shaman"

    def test_rejects_another_races_voice_set(self):
        """Vethsera is a night elf wired to the human female official voice."""
        assert flavor_from_sound_name("HumanFemaleOfficialNPCGreetings", "nightelf-female") is None

    def test_ignores_sounds_that_are_not_npc_voices(self):
        assert flavor_from_sound_name("FrostImpact") is None
        assert flavor_from_sound_name("MurlocAggro") is None
        assert flavor_from_sound_name(None) is None


class TestFallbackFlavors:
    def test_prefers_standard(self):
        resolved = [("orc-male", "standard"), ("orc-male", "guard"), ("orc-male", "guard")]
        assert fallback_flavors(resolved) == {"orc-male": "standard"}

    def test_falls_back_to_the_busiest_flavor_where_there_is_no_standard(self):
        """Four race-genders have no standard voice in the game at all."""
        resolved = [("tauren-male", "warrior"), ("tauren-male", "warrior"),
                    ("tauren-male", "elder")]
        assert fallback_flavors(resolved) == {"tauren-male": "warrior"}

    def test_breaks_ties_alphabetically(self):
        resolved = [("goblin-male", "zany"), ("goblin-male", "gruff")]
        assert fallback_flavors(resolved) == {"goblin-male": "gruff"}

    def test_ignores_race_genders_with_nothing_resolved(self):
        assert fallback_flavors([("narrator-male", None)]) == {}


class TestApplyFallbacks:
    def test_fills_only_the_gaps(self):
        got = apply_fallbacks(["orc-male", "orc-male"], ["guard", None],
                              {"orc-male": "standard"})
        assert got == ["guard", "standard"]

    def test_leaves_a_race_gender_with_no_fallback_alone(self):
        assert apply_fallbacks(["narrator-male"], [None], {}) == [None]


class TestConsensusFlavor:
    def test_takes_the_most_common(self):
        assert consensus_flavor(["guard", "standard", "guard"]) == "guard"

    def test_breaks_ties_alphabetically_so_runs_agree(self):
        assert consensus_flavor(["standard", "guard"]) == "guard"

    def test_ignores_unresolved_members(self):
        assert consensus_flavor([None, "shaman"]) == "shaman"

    def test_is_none_when_nothing_resolved(self):
        assert consensus_flavor([None, None]) is None


class TestVoiceName:
    def test_three_parts_with_a_flavor(self):
        assert voice_name("orc", "female", "shaman") == "orc-female-shaman"

    def test_two_parts_without_one(self):
        assert voice_name("narrator", "male", None) == "narrator-male"

    def test_a_model_slot_is_its_own_name(self):
        # The gender is a placeholder for a creature with no humanoid display.
        assert voice_name(model_voice(29.0), "male", None) == "model-29"

    def test_model_voices_are_recognised_by_shape(self):
        assert is_model_voice("model-29")
        assert not is_model_voice("model-29-male")
        assert not is_model_voice("narrator-male")
        assert not is_model_voice(None)


class TestFileKey:
    def test_quest_rows_share_one_group_across_flavors(self):
        # One file per quest, so a grim dwarf and a standard one must agree on a flavor.
        assert file_key("accept", 5, "h", None, "dwarf-male", "grim") == \
            file_key("accept", 5, "h", None, "dwarf-male", "standard")

    def test_gossip_rows_group_by_text_hash(self):
        assert file_key("gossip", "", "abc", None, "dwarf-male", "grim") == ("abc", "dwarf-male")

    def test_followup_rows_never_group_across_flavors(self):
        # Same words from two flavors are two files, so neither may be talked into the other's
        # voice - the reason a follow-up file is named after its voice.
        grim = file_key("followup", 5, "h", 4377.0, "dwarf-male", "grim")
        standard = file_key("followup", 5, "h", 4377, "dwarf-male", "standard")
        assert grim != standard
        assert grim == ("4377-dwarf-male-grim", "dwarf-male")

    def test_a_model_voiced_followup_is_keyed_on_its_model(self):
        assert file_key("followup", 5, "h", 3475, "model-29-male", None) == \
            ("3475-model-29", "model-29-male")

    def test_followup_rows_group_across_quests(self):
        # The same words in the same voice after two quests are one file.
        assert file_key("followup", 5, "h", 4377, "dwarf-male", "grim") == \
            file_key("followup", 9, "other", 4377, "dwarf-male", "grim")
