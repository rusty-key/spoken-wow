"""The addon zips: the quests addon's, and Spoken's, which carries its modules.

Every client picks its .toc by flavor suffix, so what these pin is that each zip carries every
flavor's .toc and unpacks into folders the client reads. Spoken's own zip carries its modules:
one download with everything in it.
"""
import os
import subprocess
import zipfile

import pytest

#: The monorepo root. This file is pipelines/quests/tests/, so four dirnames.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRIPT = os.path.join(REPO, "scripts", "quests", "package.sh")
PLAYER_SCRIPT = os.path.join(REPO, "scripts", "spoken", "package.sh")
ADDON_DIR = os.path.join(REPO, "addons", "Spoken_Quests")
PLAYER_DIR = os.path.join(REPO, "addons", "Spoken")
NAME = "Spoken_Quests"
PLAYER = "Spoken"
#: The flavor suffixes of the .toc files the modules carry for Blizzard's clients.
FLAVORS = ("", "_TBC", "_Vanilla")


def version_of(directory, name):
    path = os.path.join(directory, f"{name}.toc")
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("## Version:"):
                return line.split(":", 1)[1].strip()
    raise AssertionError(f"no '## Version:' line in {path}")


def toc_version():
    return version_of(ADDON_DIR, NAME)


def run(script, dist):
    # ALLOW_DIRTY, because a test run must not depend on the working tree being committed.
    subprocess.run([script], check=True, cwd=REPO,
                   env={**os.environ, "DIST": str(dist), "ALLOW_DIRTY": "1"},
                   capture_output=True)


def read_zips(dist):
    zips = {}
    for name in os.listdir(dist):
        with zipfile.ZipFile(dist / name) as archive:
            zips[name] = (archive.namelist(),
                          {n: archive.read(n) for n in archive.namelist() if not n.endswith("/")})
    return zips


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    """Every zip the quests script produces, as {zip name: (namelist, {name: bytes})}."""
    dist = tmp_path_factory.mktemp("dist")
    run(SCRIPT, dist)
    return read_zips(dist)


@pytest.fixture(scope="module")
def player_built(tmp_path_factory):
    dist = tmp_path_factory.mktemp("dist-player")
    run(PLAYER_SCRIPT, dist)
    return read_zips(dist)


def quests_zip(built):
    return built[f"{NAME}-{toc_version()}.zip"]


def tocs_in(files, folder):
    return {n: files[n].decode("utf-8", "replace") for n in files if n.startswith(folder + "/") and n.endswith(".toc")}


def test_one_zip(built):
    assert set(built) == {f"{NAME}-{toc_version()}.zip"}


def test_the_zip_carries_every_flavor(built):
    names, files = quests_zip(built)
    tocs = tocs_in(files, NAME)
    assert sorted(tocs) == sorted(f"{NAME}/{NAME}{suffix}.toc" for suffix in FLAVORS)
    assert any(name.startswith(f"{NAME}/Libs/") for name in names)
    # Spoken ships beside it in Spoken's own zip; it is not bundled here.
    assert {name.split("/", 1)[0] for name in names} == {NAME}
    assert "## Dependencies: Spoken" in tocs[f"{NAME}/{NAME}.toc"]


def test_every_zip_unpacks_into_the_addons_folder(built):
    # Addon hosts unpack the archive straight into Interface/AddOns, so every root must be a
    # folder the client reads.
    for name, (names, _) in built.items():
        roots = {entry.split("/", 1)[0] for entry in names}
        assert roots == {NAME}, (name, roots)


def test_spoken_ships_with_its_modules_for_blizzard_clients(player_built):
    version = version_of(PLAYER_DIR, PLAYER)
    assert set(player_built) == {f"{PLAYER}-{version}.zip"}
    names, files = player_built[f"{PLAYER}-{version}.zip"]
    tocs = tocs_in(files, PLAYER)
    assert sorted(tocs) == sorted(f"{PLAYER}/{PLAYER}{suffix}.toc" for suffix in FLAVORS)
    # Spoken, the folder whose only job is to name the gathered-lines file
    # (addons/SpokenContributions/SpokenContributions.toc): one .toc and its icon, no Lua, and the three
    # modules and Spoken NPCs: one download with everything in it.
    assert {entry.split("/", 1)[0] for entry in names} == {PLAYER, "SpokenContributions",
                                                          "Spoken_Quests", "Spoken_Readables", "Spoken_Places",
                                                          "Spoken_NPCs"}
    assert sorted(name for name in names if name.startswith("SpokenContributions/") and not name.endswith("/")) \
        == ["SpokenContributions/SpokenContributions.toc", "SpokenContributions/icon.tga"]


def test_the_compendium_files_are_spoken_s_alone():
    # Azeroth's Compendium (UI/Compendium.lua) and the text view its pages scroll in
    # (UI/TextView.lua) are Spoken's, loaded once for every module's tab.
    for name in ("Compendium.lua", "TextView.lua"):
        carriers = [addon for addon in os.listdir(os.path.join(REPO, "addons"))
                    if os.path.isfile(os.path.join(REPO, "addons", addon, "UI", name))]
        assert carriers == ["Spoken"], f"UI/{name} is carried by {carriers}"
