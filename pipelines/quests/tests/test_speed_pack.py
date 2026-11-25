"""scripts/community/speed-pack.py over packs as the generators write them.

The script rewrites generated Lua it does not own: the quests tables come from build.py here,
and the places and readables tables are the committed exports in addons/. Building from the
generators themselves means a change to their output breaks these tests, not players' packs.
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import zipfile

import pytest

from tts_cli.build import build_module

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")

spec = importlib.util.spec_from_file_location(
    "speed_pack", os.path.join(ROOT, "scripts", "community", "speed-pack.py"))
speed_pack = importlib.util.module_from_spec(spec)
# Dataclasses look their module up by name while it loads.
sys.modules["speed_pack"] = speed_pack
spec.loader.exec_module(speed_pack)

needs_luajit = pytest.mark.skipif(shutil.which("luajit") is None, reason="needs luajit")

CORPUS = {
    "lines": [
        {"lineId": "q:5:accept", "source": "accept", "questId": 5,
         "questTitle": "Growling Gut", "npcId": 288, "npcName": "Jitters",
         "npcType": "creature", "fileName": "5-accept",
         "originalText": "Find my pack.", "generatable": True},
        {"lineId": "g:abc123", "source": "gossip", "questId": None, "questTitle": None,
         "npcId": 68, "npcName": "Stormwind City Guard", "npcType": "creature",
         "fileName": "abc123", "originalText": "Move along.", "generatable": True},
    ],
}
TIMES = {"quests/5-accept": "0 .5 1.25", "gossip/abc123": "0 .3"}


class CopyEncoder:
    """Copies each clip: these tests are about the pack around the audio."""

    def __init__(self):
        self.encoded = []

    def settings(self):
        return {"stub": 1}

    def encode(self, src, out, speed, extension, rate):
        self.encoded.append(src.name)
        shutil.copy(src, out)


def quests_pack(tmp_path, folder, **options):
    store = tmp_path / "store"
    for rel in ("quests/5-accept.ogg", "gossip/abc123.ogg"):
        (store / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(os.path.join(FIXTURES, "tone.ogg"), store / rel)
    (store / "word-times.json").write_text(json.dumps(TIMES))
    report = build_module(CORPUS, str(store), str(tmp_path / "dist"), folder, version="2.5.0", **options)
    return report["moduleDir"]


def speed_up(tmp_path, source_dir, speed=2.0, pack_id="maker-quests-enus-x200", encoder=None):
    [source] = speed_pack.read_sources(str(source_dir), None)
    plan = speed_pack.inspect(source)
    plan.speed, plan.pack_id, plan.folder = speed, pack_id, f"SpokenCommunity_{pack_id}"
    encoder = encoder or CopyEncoder()
    cache = speed_pack.Cache(tmp_path / "cache", pack_id, speed, encoder.settings())
    clips = speed_pack.encode_all(plan, cache, encoder, 2, lambda _: None)
    zip_path = speed_pack.build(plan, "2.5.0", "Maker", clips, tmp_path / "out")
    cache.prune()
    target = tmp_path / "unzipped"
    shutil.rmtree(target, ignore_errors=True)
    with zipfile.ZipFile(zip_path) as archive:
        assert {name.split("/")[0] for name in archive.namelist()} == {plan.folder}
        archive.extractall(target)
    return plan, target / plan.folder


def load_quests(module_dir, folder, probe_path, body):
    """Loads a quests pack the way Spoken does, in the order its .toc lists, then runs `body`."""
    with open(os.path.join(module_dir, folder + ".toc"), encoding="utf-8") as f:
        files = [line.strip().replace("\\", "/") for line in f if line.strip() and not line.startswith(("#", "##"))]
    probe_path.write_text(
        "registered = {}\n"
        "local event = {}\n"
        "VoiceOver = {DataModules = {Register = function(_, name, module) registered[name] = module end},\n"
        "    Language = {GetClientLanguage = function() return 'enUS' end},\n"
        "    Enums = {SoundEvent = {IsQuestEvent = function(_, e) return e == event end,\n"
        "                           IsGossipEvent = function() return false end}},\n"
        "    format = string.format}\n"
        + "".join(f"assert(loadfile([[{os.path.join(module_dir, name)}]]))()\n" for name in files)
        + body, encoding="utf-8")
    run = subprocess.run(["luajit", str(probe_path)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return run.stdout


@needs_luajit
@pytest.mark.parametrize("folder,options", [
    ("SpokenQuestsAudio_enUS", {}),
    # A team's pack binds its module to a local, its folder being no Lua identifier.
    ("SpokenQuestsAudioAlliance_esMX_team-two", {"language": "esMX",
                                                 "toc_extra": [("X-Spoken-Team", "team-two")]}),
])
def test_a_quests_pack_loads_under_its_new_folder_with_its_numbers_scaled(tmp_path, folder, options):
    source_dir = quests_pack(tmp_path, folder, **options)
    plan, built = speed_up(tmp_path, source_dir)

    lengths = load_quests(source_dir, folder, tmp_path / "before.lua",
                          f'local m = registered["{folder}"]\n'
                          'print(m.SoundLengthLookupByFileName["5-accept"])\n')
    out = load_quests(built, plan.folder, tmp_path / "after.lua",
                      f'local m = registered["{plan.folder}"]\n'
                      f'assert(m and _G["{plan.folder}"] == m and not registered["{folder}"])\n'
                      'assert(m:GetSoundPath("5-accept", event) == [[generated\\sounds\\quests\\5-accept.ogg]])\n'
                      'print(m.SoundLengthLookupByFileName["5-accept"])\n'
                      'print(m.WordTimesByFileName["5-accept"])\n'
                      'print(m.WordTimesByFileName["abc123"])\n')
    length, times, gossip = out.split("\n")[:3]
    assert float(length) == pytest.approx(float(lengths) / 2, abs=0.001)
    assert times == "0 .25 .63"
    assert gossip == "0 .15"


def test_a_quests_pack_toc_names_the_voice_and_its_source(tmp_path):
    source_dir = quests_pack(tmp_path, "SpokenQuestsAudio_enUS")
    plan, built = speed_up(tmp_path, source_dir, speed=1.5, pack_id="maker-quests-enus-x150")

    toc = (built / f"{plan.folder}.toc").read_text(encoding="utf-8")
    assert "## X-Spoken-Team: speed-x150\n" in toc
    assert "## X-Spoken-TeamName: 1.5x\n" in toc
    assert "## X-Spoken-SpeedOf: SpokenQuestsAudio_enUS 2.5.0\n" in toc
    assert "## Version: 2.5.0\n" in toc
    assert f"## IconTexture: Interface\\AddOns\\{plan.folder}\\" in toc
    assert "SpokenQuestsAudio_enUS\\" not in toc
    # Still found by Spoken as a quests pack.
    assert "## X-SpokenQuests-DataModule-Version: 1\n" in toc


def test_a_teams_pack_keeps_its_team_in_the_new_voice(tmp_path):
    source_dir = quests_pack(tmp_path, "SpokenQuestsAudio_esMX_team-two", language="esMX",
                             toc_extra=[("X-Spoken-Team", "team-two"), ("X-Spoken-TeamName", "Team Two")])
    plan, built = speed_up(tmp_path, source_dir, speed=1.25, pack_id="maker-quests-esmx-x125")

    toc = (built / f"{plan.folder}.toc").read_text(encoding="utf-8")
    assert "## X-Spoken-Team: team-two-x125\n" in toc
    assert "## X-Spoken-TeamName: Team Two 1.25x\n" in toc
    assert plan.language == "esMX"


def sounds_rows(path, addon):
    """{id: (len, times)} of a Data/Sounds.lua, read by luajit as the addon reads it."""
    probe = path.parent / "probe_rows.lua"
    probe.write_text(
        "GetAddOnMetadata = function() return nil end\n"
        f"assert(loadfile([[{path}]]))('{addon}')\n"
        "local pack = select(2, next(SpokenPlacesAudioPacks or SpokenReadablesAudioPacks))\n"
        "local function walk(t, prefix)\n"
        "  for k, v in pairs(t) do\n"
        "    if type(v) == 'table' and v.len then print(prefix .. tostring(k), v.len, v.times or '')\n"
        "    elseif type(v) == 'table' then walk(v, prefix .. tostring(k) .. '/') end\n"
        "  end\n"
        "end\n"
        "walk(pack, '')\n", encoding="utf-8")
    run = subprocess.run(["luajit", str(probe)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    rows = {}
    for line in run.stdout.splitlines():
        key, length, times = (line.split("\t") + [""])[:3]
        rows[key] = (float(length), times)
    return rows


@needs_luajit
@pytest.mark.parametrize("addon,section", [("SpokenPlacesAudio", "places"), ("SpokenReadablesAudio", "readables")])
def test_every_row_of_a_committed_sounds_table_is_scaled(tmp_path, addon, section):
    source_dir = tmp_path / addon
    shutil.copytree(os.path.join(ROOT, "addons", addon), source_dir)
    (source_dir / "Sounds").mkdir(exist_ok=True)
    shutil.copy(os.path.join(FIXTURES, "tone.mp3"), source_dir / "Sounds" / "1.mp3")

    plan, built = speed_up(tmp_path, source_dir, speed=1.5, pack_id=f"maker-{section}-x150")

    assert plan.section == section
    before = sounds_rows(source_dir / "Data" / "Sounds.lua", addon)
    after = sounds_rows(built / "Data" / "Sounds.lua", plan.folder)
    assert before and before.keys() == after.keys()
    for key, (length, times) in before.items():
        assert after[key][0] == pytest.approx(length / 1.5, abs=0.001), key
        if times:
            scaled = [float(t) / 1.5 for t in times.split()]
            assert [float(t) for t in after[key][1].split()] == pytest.approx(scaled, abs=0.006), key


def test_numbers_inside_a_lines_text_are_left_alone():
    source = 'local pack = { rows = { [1] = { file = "1", len = 3, text = "len = 9, times = \\"1 2\\"" } } }'
    scaled, count = speed_pack.scale_values(source, 2.0, speed_pack.field_value("len"),
                                            speed_pack.field_value("times"))
    assert count == 1
    assert 'len = 1.5, text = "len = 9, times = \\"1 2\\""' in scaled


def test_a_rebuild_encodes_only_new_or_changed_clips(tmp_path):
    source_dir = quests_pack(tmp_path, "SpokenQuestsAudio_enUS")
    first = CopyEncoder()
    speed_up(tmp_path, source_dir, encoder=first)
    assert len(first.encoded) == 2

    again = CopyEncoder()
    speed_up(tmp_path, source_dir, encoder=again)
    assert again.encoded == []

    clip = os.path.join(source_dir, "generated", "sounds", "gossip", "abc123.ogg")
    with open(clip, "ab") as f:
        f.write(b"\0")
    changed = CopyEncoder()
    speed_up(tmp_path, source_dir, encoder=changed)
    assert len(changed.encoded) == 1
    # The clip it replaced is gone from the cache.
    cached = [p for p in (tmp_path / "cache" / "maker-quests-enus-x200" / "2").iterdir() if p.suffix == ".ogg"]
    assert len(cached) == 2


def test_the_cache_is_kept_apart_by_pack_and_speed(tmp_path):
    source_dir = quests_pack(tmp_path, "SpokenQuestsAudio_enUS")
    speed_up(tmp_path, source_dir, speed=2.0, pack_id="maker-quests-enus-x200")
    other = CopyEncoder()
    speed_up(tmp_path, source_dir, speed=1.5, pack_id="maker-quests-enus-x150", encoder=other)
    assert len(other.encoded) == 2
    assert {p.name for p in (tmp_path / "cache").iterdir()} == {"maker-quests-enus-x200", "maker-quests-enus-x150"}


def test_the_same_clips_give_the_same_zip(tmp_path):
    source_dir = quests_pack(tmp_path, "SpokenQuestsAudio_enUS")
    speed_up(tmp_path, source_dir)
    first = speed_pack.sha256_of(tmp_path / "out" / "SpokenCommunity_maker-quests-enus-x200.zip")
    speed_up(tmp_path, source_dir)
    assert speed_pack.sha256_of(tmp_path / "out" / "SpokenCommunity_maker-quests-enus-x200.zip") == first


@pytest.mark.parametrize("source,live,expected", [
    ("2.5.0", None, "2.5.0"),
    ("2.5.0", "2.4.0", "2.5.0"),
    ("2.5.0", "2.5.0", "2.5.0.1"),
    ("2.5.0", "2.5.0.3", "2.5.0.4"),
    ("2.5.0", "3.0.0", "2.5.0.1"),
])
def test_a_rebuild_is_a_newer_version(source, live, expected):
    assert speed_pack.next_version(source, live) == expected


def test_default_ids_are_the_makers_and_follow_the_sites_rule():
    pack_id = speed_pack.default_pack_id("poltiger", "SpokenQuestsAudioAlliance_enUS", 1.5)
    assert pack_id == "poltiger-quests-alliance-enus-x150"
    assert speed_pack.PACK_ID.match(pack_id)
    assert speed_pack.default_pack_id("", "SpokenReadablesAudio_deDE", 0.8) == "readables-dede-x80"


@pytest.mark.parametrize("speed,chain", [
    (1.5, "atempo=1.5"),
    (3.0, "atempo=2,atempo=1.5"),
    (0.4, "atempo=0.5,atempo=0.8"),
])
def test_large_changes_chain_atempo(speed, chain):
    assert speed_pack.atempo(speed) == chain


@pytest.mark.skipif(not (os.environ.get("FFMPEG") or shutil.which("ffmpeg")), reason="needs ffmpeg")
@pytest.mark.parametrize("extension", [".mp3", ".ogg"])
def test_ffmpeg_halves_a_clip_at_double_speed(tmp_path, extension):
    import math
    import struct
    import wave

    import mutagen

    encoder = speed_pack.Encoder.find()
    if extension == ".ogg" and not encoder.libvorbis and not encoder.oggenc:
        pytest.skip("needs libvorbis or oggenc")
    # Three seconds, so the encoders' padding is small beside it.
    tone = tmp_path / "tone.wav"
    with wave.open(str(tone), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(i / 10))) for i in range(22050 * 3)))
    source = tmp_path / ("source" + extension)
    encoder.encode(tone, source, 1.0, extension, 22050)
    fast = tmp_path / ("fast" + extension)
    rate = speed_pack.vorbis_rate(source.read_bytes()) if extension == ".ogg" else None
    encoder.encode(source, fast, 2.0, extension, rate)

    assert mutagen.File(str(fast)).info.length == pytest.approx(mutagen.File(str(source)).info.length / 2, rel=0.05)
    if extension == ".ogg":
        assert rate == 22050


class FakeSite:
    def __init__(self, owned):
        self.packs, self.calls = owned, []

    def owned(self):
        return self.packs

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        return {}


def publish(tmp_path, monkeypatch, owned):
    source_dir = quests_pack(tmp_path, "SpokenQuestsAudio_enUS")
    site = FakeSite(owned)
    uploads = []
    monkeypatch.setattr(speed_pack, "Site", lambda base, token: site)
    monkeypatch.setattr(speed_pack, "upload", lambda repo, tag, title, notes, path: uploads.append(tag)
                        or f"https://github.com/{repo}/releases/download/{tag}/{path.name}")
    monkeypatch.setattr(speed_pack.Encoder, "find", staticmethod(CopyEncoder))
    monkeypatch.setattr(speed_pack, "load_config", lambda: {
        "repo": "maker/packs", "token": "spk_x", "prefix": "maker", "author": "Maker"})
    code = speed_pack.main([str(source_dir), "--speed", "2", "--out", str(tmp_path / "out"),
                            "--cache", str(tmp_path / "cache")])
    return code, site.calls, uploads


def test_a_new_pack_is_created_with_its_language_and_section(tmp_path, monkeypatch):
    code, calls, uploads = publish(tmp_path, monkeypatch, {})
    assert code == 0 and uploads == ["maker-quests-enus-x200-v2.5.0"]
    [(method, path, body)] = calls
    assert (method, path) == ("POST", "/api/v1/packs")
    assert body["id"] == "maker-quests-enus-x200" and body["lang"] == "enUS" and body["section"] == "quests"
    assert body["url"].endswith("/maker-quests-enus-x200-v2.5.0/SpokenCommunity_maker-quests-enus-x200.zip")
    assert body["version"] == "2.5.0" and len(body["sha256"]) == 64


def test_a_listed_pack_gets_a_newer_version(tmp_path, monkeypatch):
    live = {"version": "2.5.0", "sha256": "0" * 64}
    code, calls, uploads = publish(tmp_path, monkeypatch,
                                   {"maker-quests-enus-x200": {"live": live, "pending": None}})
    assert code == 0
    [(method, path, body)] = calls
    assert path == "/api/v1/packs/maker-quests-enus-x200/submissions"
    assert body["version"] == "2.5.0.1"


def test_a_pack_with_a_version_waiting_is_left_alone(tmp_path, monkeypatch, capsys):
    code, calls, uploads = publish(tmp_path, monkeypatch, {
        "maker-quests-enus-x200": {"live": None, "pending": {"version": "2.5.0"}}})
    assert code == 1 and calls == [] and uploads == []
    assert "waiting for review" in capsys.readouterr().err
