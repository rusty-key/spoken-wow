"""The meta addon: an install of nothing that pulls the packs in behind it.

It is a shell script rather than Python, but the one invariant worth pinning is not about
shell: a stub carrying the data-module key would be enumerated by the player as a pack, and a
player holding only the stub would stop being told where to get any audio.
"""
import os
import subprocess

#: The monorepo root. This file is pipelines/quests/tests/, so four dirnames. The addon
#: source and the packaging scripts both moved out from under the pipeline in the merge.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRIPT = os.path.join(REPO, "scripts", "quests", "package-meta.sh")


def build(tmp_path, version="9.9.9"):
    subprocess.run([SCRIPT], check=True, cwd=REPO,
                   env={**os.environ, "DIST": str(tmp_path), "VERSION": version, "ZIP": "0"},
                   capture_output=True)
    toc = tmp_path / "VoiceOverReduxAudio" / "VoiceOverReduxAudio.toc"
    return toc.read_text(encoding="utf-8")


def test_the_stub_is_not_a_data_module(tmp_path):
    # The key the player enumerates packs by. With it, the stub counts as an installed pack:
    # DataModules:EnumerateAddons would stop advertising the real ones, and somebody who
    # installed only this would be told nothing is missing while hearing silence.
    toc = build(tmp_path)
    assert "X-VoiceOver-DataModule" not in toc
    assert "X-SpokenQuests-DataModule" not in toc


def test_the_stub_nests_under_spoken(tmp_path):
    # Group and X-Child-Of name a folder. Group names Spoken, where every addon and pack
    # of the project sits; X-Child-Of, read only by addon managers, names the addon that plays
    # the packs, not the SpokenQuests folder it shipped in before 3.0.
    toc = build(tmp_path)

    assert "## Group: Spoken\n" in toc
    assert "## X-Part-Of: Spoken\n" in toc
    assert "## X-Child-Of: Spoken_Quests\n" in toc


def test_the_stub_carries_the_version_it_was_built_with(tmp_path):
    # release.sh reads the version back out of this TOC to name the zip it uploads.
    assert "## Version: 9.9.9\n" in build(tmp_path, "9.9.9")


def test_the_stub_ships_no_audio(tmp_path):
    build(tmp_path)
    module = tmp_path / "VoiceOverReduxAudio"
    assert not any(name.endswith((".ogg", ".mp3")) for name in os.listdir(module))


def test_every_listed_file_exists(tmp_path):
    # A TOC listing a file that is not there half-loads the addon, which is the one way a stub
    # this small can still be broken.
    toc = build(tmp_path)
    module = tmp_path / "VoiceOverReduxAudio"
    listed = [line.strip() for line in toc.splitlines()
              if line.strip().endswith((".lua", ".xml"))]
    assert listed, "the stub should list at least one file"
    for name in listed:
        assert (module / name).is_file(), name
