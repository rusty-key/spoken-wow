import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave
import zipfile

from combat_catalogue import CATALOGUE, LUA_CATALOGUE, lua_catalogue


spec = importlib.util.spec_from_file_location("package_combat", Path(__file__).with_name("package-combat-recordings.py"))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class RecordingPackageTests(unittest.TestCase):
    def test_catalogue_covers_classic_era_and_matches_the_addon(self):
        data = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        expected = {(race, sex) for race in ["Human", "Dwarf", "NightElf", "Gnome", "Orc", "Scourge", "Tauren", "Troll"] for sex in [2, 3]}
        self.assertEqual({(voice["race"], voice["sex"]) for voice in data["voices"]}, expected)
        self.assertEqual(len({voice["id"] for voice in data["voices"]}), 16)
        self.assertTrue(all(voice["id"].endswith("-player") for voice in data["voices"]))
        self.assertEqual(LUA_CATALOGUE.read_text(encoding="utf-8"), lua_catalogue())
        for voice in data["voices"]:
            if voice["lines"]:
                self.assertEqual([line["key"] for line in voice["lines"]], data["keys"])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "recordings"
        self.source.mkdir()
        self.output = self.root / "out.zip"
        for number in range(1, 9):
            self.wav(self.source / f"{number:02d}.wav")

    def wav(self, path, seconds=1):
        with wave.open(str(path), "wb") as recording:
            recording.setparams((1, 2, 22050, 0, "NONE", "not compressed"))
            recording.writeframes(b"\0\0" * int(22050 * seconds))

    def test_complete_set_preserves_audio_and_measures_manifest(self):
        packager.package_recordings(self.source, self.output)
        with zipfile.ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(len(archive.namelist()), 10)
            self.assertEqual({name.split("/")[0] for name in archive.namelist()}, {"SpokenCombatAudio"})
            self.assertIn("Data/Sounds.lua", archive.read("SpokenCombatAudio/SpokenCombatAudio.toc").decode())
            self.assertIn('length = 1.000, format = "wav"', archive.read("SpokenCombatAudio/Data/Sounds.lua").decode())
            self.assertEqual(archive.read("SpokenCombatAudio/Sounds/Combat/nightelf-female-player-01.wav"),
                             (self.source / "01.wav").read_bytes())

    def test_missing_recordings_do_not_replace_existing_output(self):
        (self.source / "08.wav").unlink()
        self.output.write_bytes(b"keep existing package")
        with self.assertRaisesRegex(ValueError, "Missing recordings: 08"):
            packager.package_recordings(self.source, self.output)
        self.assertEqual(self.output.read_bytes(), b"keep existing package")

    def test_single_dwarf_set_uses_its_own_identity(self):
        packager.package_recordings(self.source, self.output, voice="dwarf-female-player")
        with zipfile.ZipFile(self.output) as archive:
            manifest = archive.read("SpokenCombatAudio/Data/Sounds.lua").decode()
            self.assertIn('SpokenCombatAudioPacks[addon .. ":dwarf-female-player"]', manifest)
            self.assertIn("SpokenCombatAudio/Sounds/Combat/dwarf-female-player-01.wav", archive.namelist())
            self.assertNotIn("nightelf", manifest)

    def test_multiple_sets_share_one_addon_without_overwriting_entries(self):
        collection = self.root / "collection"
        for voice in ["nightelf-female-player", "dwarf-female-player"]:
            folder = collection / voice
            folder.mkdir(parents=True)
            for number in range(1, 9):
                self.wav(folder / f"{number:02d}.wav")
        inventory = packager.package_recordings(collection, self.output)
        self.assertEqual(inventory, {"dwarf-female-player": 8, "nightelf-female-player": 8})
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(len(archive.namelist()), 18)
            manifest = archive.read("SpokenCombatAudio/Data/Sounds.lua").decode()
            self.assertIn('addon .. ":nightelf-female-player"', manifest)
            self.assertIn('addon .. ":dwarf-female-player"', manifest)
        (collection / "dwarf-female-player/08.wav").unlink()
        original = self.output.read_bytes()
        with self.assertRaisesRegex(ValueError, "Missing recordings"):
            packager.package_recordings(collection, self.output)
        self.assertEqual(self.output.read_bytes(), original)

    def test_cli_lists_the_packaged_voice_and_explains_installation_replacement(self):
        result = subprocess.run([sys.executable, packager.__file__, str(self.source),
                                 "--voice", "dwarf-female-player", "--output", str(self.output)],
                                capture_output=True, text=True, encoding="utf-8", check=True)
        self.assertIn("Voice sets included:\n  - dwarf-female-player: 8 recordings", result.stdout)
        self.assertNotIn("nightelf-female-player", result.stdout)
        self.assertIn("Installing this zip replaces the voice sets available from SpokenCombatAudio", result.stdout)
        with zipfile.ZipFile(self.output) as archive:
            self.assertIn("SpokenCombatAudio/Sounds/Combat/dwarf-female-player-08.wav", archive.namelist())

    def test_cli_does_not_advertise_an_inventory_when_packaging_fails(self):
        (self.source / "08.wav").unlink()
        result = subprocess.run([sys.executable, packager.__file__, str(self.source), "--output", str(self.output)],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("Voice sets included", result.stdout)
        self.assertFalse(self.output.exists())

    def test_unknown_voice_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown combat voice"):
            packager.package_recordings(self.source, self.output, voice="../unknown")

    def test_duplicate_key_is_rejected(self):
        self.wav(self.source / "nightelf-female-player-01.wav")
        with self.assertRaisesRegex(ValueError, "More than one"):
            packager.package_recordings(self.source, self.output)

    def test_extra_audio_is_rejected(self):
        self.wav(self.source / "09.wav")
        with self.assertRaisesRegex(ValueError, "Unexpected recording"):
            packager.package_recordings(self.source, self.output)

    def test_long_audio_is_rejected(self):
        self.wav(self.source / "01.wav", seconds=7)
        with self.assertRaisesRegex(ValueError, "6-second limit"):
            packager.package_recordings(self.source, self.output)

    def test_compressed_input_requires_a_duration_reader(self):
        with self.assertRaisesRegex(ValueError, "ffprobe is required"):
            packager.duration_of(self.source / "01.mp3", None)

    def test_output_cannot_overwrite_a_supplied_recording(self):
        file = self.source / "01.wav"
        original = file.read_bytes()
        with self.assertRaisesRegex(ValueError, "must not replace"):
            packager.package_recordings(self.source, file)
        self.assertEqual(file.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
