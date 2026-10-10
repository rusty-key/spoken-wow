"""The addon zips: one for Blizzard's clients, one apiece for the older ones, and the player.

A WoW client before flavor suffixes opens `Spoken_Quests.toc` and nothing else, so what these
pin is which single .toc each legacy zip carries and which vendored Ace3 travels with it. Both
mistakes are silent - the addon simply does not load, or loads a library that binds an API the
client has never had - and neither shows up until somebody launches that client.

One more thing is pinned: the legacy zips carry Spoken itself, because those clients have no
addon manager to install a dependency, and what they carry must be byte-identical to Spoken's
own tree. They carry the gossip module the same way: it was part of this addon, and these zips
are the one download there. Spoken's own zip carries its modules: one download with everything
in it.

And the tombstones: a folder an older release installed, overwritten with .toc files that never
load. SpokenPlayer travels with every zip carrying Spoken; SpokenQuests, SpokenZones and
SpokenBooks, the modules' folders before they were renamed, ship as the retired projects' last
releases, and SpokenQuests in the legacy zips too.
"""
import os
import subprocess
import zipfile

import pytest

#: The monorepo root. This file is pipelines/quests/tests/, so four dirnames.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRIPT = os.path.join(REPO, "scripts", "quests", "package.sh")
PLAYER_SCRIPT = os.path.join(REPO, "scripts", "spoken", "package.sh")
RETIRED_SCRIPT = os.path.join(REPO, "scripts", "spoken", "package-retired.sh")
GOSSIP_SCRIPT = os.path.join(REPO, "scripts", "gossip", "package.sh")
ADDON_DIR = os.path.join(REPO, "addons", "Spoken_Quests")
PLAYER_DIR = os.path.join(REPO, "addons", "Spoken")
GOSSIP_DIR = os.path.join(REPO, "addons", "Spoken_Gossip")
NAME = "Spoken_Quests"
PLAYER = "Spoken"
GOSSIP = "Spoken_Gossip"
#: The folder Spoken had before 3.0.0, which every zip carrying Spoken overwrites with a tombstone.
TOMBSTONE = "SpokenPlayer"
#: This module's folder before 3.0.0-beta.3, which the legacy zips overwrite with a tombstone.
OLD_NAME = "SpokenQuests"
#: Each retired project's folder -> the module folder that replaced it, and the flavor suffixes
#: of the .toc names the old folder had on Blizzard's clients.
RETIRED = {
    "SpokenQuests": ("Spoken_Quests", ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath")),
    "SpokenZones": ("Spoken_Zones", ("",)),
    "SpokenBooks": ("Spoken_Books", ("",)),
}

#: client label -> the Interface version its .toc must declare.
LEGACY_CLIENTS = {"1.12": "11200", "2.4.3": "20400", "3.3.5": "30300"}


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


@pytest.fixture(scope="module")
def gossip_built(tmp_path_factory):
    dist = tmp_path_factory.mktemp("dist-gossip")
    run(GOSSIP_SCRIPT, dist)
    return read_zips(dist)


@pytest.fixture(scope="module")
def retired_built(tmp_path_factory):
    dist = tmp_path_factory.mktemp("dist-retired")
    run(RETIRED_SCRIPT, dist)
    return read_zips(dist)


def interface_of(path):
    with open(path, encoding="utf-8") as handle:
        return handle.readline().split(":", 1)[1].strip()


def modern(built):
    return built[f"{NAME}-{toc_version()}.zip"]


def legacy(built, client):
    return built[f"{NAME}-WoW_{client}-{toc_version()}.zip"]


def tocs_in(files, folder):
    return {n: files[n].decode("utf-8", "replace") for n in files if n.startswith(folder + "/") and n.endswith(".toc")}


def test_one_zip_per_client_family(built):
    assert set(built) == {f"{NAME}-{toc_version()}.zip"} | {
        f"{NAME}-WoW_{client}-{toc_version()}.zip" for client in LEGACY_CLIENTS}


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_carries_exactly_one_toc_and_it_is_that_client_s(built, client, interface):
    names, files = legacy(built, client)
    tocs = tocs_in(files, NAME)
    assert list(tocs) == [f"{NAME}/{NAME}.toc"], names
    assert tocs[f"{NAME}/{NAME}.toc"].startswith(f"## Interface: {interface}")


@pytest.mark.parametrize("client", sorted(LEGACY_CLIENTS))
def test_a_legacy_zip_carries_only_its_own_ace3(built, client):
    names, _ = legacy(built, client)
    # The root Libs/ binds C_Timer.After while loading, which is an error on every client this
    # zip is for; each of them has a fork of Ace3 under its own directory instead.
    for folder in (NAME, PLAYER):
        assert not any(name.startswith(f"{folder}/Libs/") for name in names)
        assert f"{folder}/{client}/embeds.xml" in names
        for other in LEGACY_CLIENTS:
            if other != client:
                assert not any(name.startswith(f"{folder}/{other}/") for name in names)


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_bundles_the_player_with_a_hard_dependency(built, client, interface):
    # No addon manager on these clients, so the player travels inside the zip - and since it
    # is guaranteed present, the dependency can be hard here where it is soft everywhere else.
    names, files = legacy(built, client)
    tocs = tocs_in(files, PLAYER)
    assert list(tocs) == [f"{PLAYER}/{PLAYER}.toc"], names
    assert tocs[f"{PLAYER}/{PLAYER}.toc"].startswith(f"## Interface: {interface}")
    assert "## Dependencies: Spoken" in files[f"{NAME}/{NAME}.toc"].decode()
    assert "## OptionalDeps: Spoken" not in files[f"{NAME}/{NAME}.toc"].decode()


@pytest.mark.parametrize("folder,directory", [(PLAYER, PLAYER_DIR), (GOSSIP, GOSSIP_DIR)])
@pytest.mark.parametrize("client", sorted(LEGACY_CLIENTS))
def test_the_bundled_player_is_byte_identical_to_its_tree(built, client, folder, directory):
    # The one source tree, staged at build time: there is no committed second copy that
    # could drift. Everything under Spoken/ (and Spoken_Gossip/) in the zip equals the repo file,
    # except the per-client Libs pruning and the .toc swap the packaging is for.
    names, files = legacy(built, client)
    bundled = [n for n in names if n.startswith(f"{folder}/") and not n.endswith("/")]
    assert bundled, names
    for name in bundled:
        relative = name[len(folder) + 1:]
        if relative == f"{folder}.toc":
            source = os.path.join(directory, f"{folder}_{client}.toc")
        else:
            source = os.path.join(directory, relative)
        with open(source, "rb") as handle:
            assert files[name] == handle.read(), name


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_bundles_the_gossip_module_for_that_client(built, client, interface):
    # Gossip was read by this addon until it became a module: on these clients the quests zip
    # still brings it, with the one .toc the client reads and only that client's Ace3.
    names, files = legacy(built, client)
    tocs = tocs_in(files, GOSSIP)
    assert list(tocs) == [f"{GOSSIP}/{GOSSIP}.toc"], names
    assert tocs[f"{GOSSIP}/{GOSSIP}.toc"].startswith(f"## Interface: {interface}")
    assert "## Dependencies: Spoken" in tocs[f"{GOSSIP}/{GOSSIP}.toc"]
    assert any(name.startswith(f"{GOSSIP}/{client}/Libs/") for name in names)
    for other in LEGACY_CLIENTS:
        if other != client:
            assert not any(name.startswith(f"{GOSSIP}/{other}/") for name in names)
    assert not any(name.startswith(f"{GOSSIP}/Libs/") for name in names)


def test_the_gossip_zip_carries_every_flavor_and_no_legacy_client(gossip_built):
    version = version_of(GOSSIP_DIR, GOSSIP)
    assert set(gossip_built) == {f"{GOSSIP}-{version}.zip"}
    names, files = gossip_built[f"{GOSSIP}-{version}.zip"]
    tocs = tocs_in(files, GOSSIP)
    assert sorted(tocs) == sorted(f"{GOSSIP}/{GOSSIP}{suffix}.toc" for suffix in
                                  ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath"))
    for client in LEGACY_CLIENTS:
        assert not any(name.startswith(f"{GOSSIP}/{client}/") for name in names)
    assert {name.split("/", 1)[0] for name in names} == {GOSSIP}
    assert "## OptionalDeps: Spoken" in tocs[f"{GOSSIP}/{GOSSIP}.toc"]


def test_the_blizzard_zip_carries_every_flavor_and_no_legacy_client(built):
    names, files = modern(built)
    tocs = tocs_in(files, NAME)
    assert sorted(tocs) == sorted(f"{NAME}/{NAME}{suffix}.toc" for suffix in
                                  ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath"))
    for client in LEGACY_CLIENTS:
        assert not any(name.startswith(f"{NAME}/{client}/") for name in names)
    assert any(name.startswith(f"{NAME}/Libs/") for name in names)
    # Managers install the player from the CurseForge dependency; it is not bundled here. Nor is
    # the old folder's tombstone: that folder belongs to the retired spoken-quests project.
    assert {name.split("/", 1)[0] for name in names} == {NAME}
    assert "## OptionalDeps: Spoken" in tocs[f"{NAME}/{NAME}.toc"]


def test_every_zip_unpacks_into_the_addons_folder(built):
    # Addon hosts unpack the archive straight into Interface/AddOns, so every root must be a
    # folder the client reads: the addon, or Spoken and the tombstones, which the legacy zips bundle.
    for name, (names, _) in built.items():
        roots = {entry.split("/", 1)[0] for entry in names}
        assert roots <= {NAME, PLAYER, GOSSIP, TOMBSTONE, OLD_NAME}, (name, roots)


def assert_tombstone(files, expected, folder=TOMBSTONE):
    """`folder` holds exactly `expected` {.toc name: Interface line}, each one the tombstone:
    no file listed, never loaded, greyed out as now being in Spoken."""
    tombstone = {n: files[n].decode() for n in files if n.startswith(f"{folder}/")}
    assert sorted(tombstone) == sorted(f"{folder}/{toc}" for toc in expected), tombstone
    for toc, interface in expected.items():
        text = tombstone[f"{folder}/{toc}"]
        assert text.startswith(f"## Interface: {interface}\n"), (toc, text)
        assert "## LoadOnDemand: 1" in text
        assert "## Group: Spoken\n" in text
        assert "This folder never loads and is safe to delete." in text
        assert not [line for line in text.splitlines() if line.strip() and not line.startswith("#")], text


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_overwrites_the_old_player_with_a_tombstone(built, client, interface):
    # Before 3.0.0 these zips carried SpokenPlayer; unzipping over it must leave nothing to load.
    _, files = legacy(built, client)
    assert_tombstone(files, {f"{TOMBSTONE}.toc": interface})


@pytest.mark.parametrize("client,interface", sorted(LEGACY_CLIENTS.items()))
def test_a_legacy_zip_overwrites_the_old_module_folder_with_a_tombstone(built, client, interface):
    # Before 3.0.0-beta.3 these zips carried the module as SpokenQuests; unzipping over it must
    # leave that copy nothing to load beside Spoken_Quests.
    _, files = legacy(built, client)
    assert_tombstone(files, {f"{OLD_NAME}.toc": interface}, OLD_NAME)
    assert "(now in Spoken)" in files[f"{OLD_NAME}/{OLD_NAME}.toc"].decode()


def test_spoken_ships_with_its_modules_for_blizzard_clients(player_built):
    version = version_of(PLAYER_DIR, PLAYER)
    assert set(player_built) == {f"{PLAYER}-{version}.zip"}
    names, files = player_built[f"{PLAYER}-{version}.zip"]
    tocs = tocs_in(files, PLAYER)
    assert sorted(tocs) == sorted(f"{PLAYER}/{PLAYER}{suffix}.toc" for suffix in
                                  ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath"))
    for client in LEGACY_CLIENTS:
        assert not any(name.startswith(f"{PLAYER}/{client}/") for name in names)
    # Spoken, the folder whose only job is to name the gathered-lines file
    # (addons/SpokenContributions/SpokenContributions.toc): one .toc, no Lua, and the four
    # modules: one download with everything in it.
    # No tombstone for the modules' old folders, which belong to the retired projects: two
    # projects shipping one folder is what the rename exists to stop.
    assert {entry.split("/", 1)[0] for entry in names} == {PLAYER, "SpokenContributions", TOMBSTONE,
                                                          "Spoken_Quests", "Spoken_Gossip", "Spoken_Books",
                                                          "Spoken_Zones"}
    assert [name for name in names if name.startswith("SpokenContributions/") and not name.endswith("/")] \
        == ["SpokenContributions/SpokenContributions.toc"]
    # Every .toc name the old player's folder had on these clients, so an unzip over it leaves
    # the old Lua with nothing to load it.
    interfaces = {f"{TOMBSTONE}{suffix}.toc": interface_of(os.path.join(PLAYER_DIR, f"{PLAYER}{suffix}.toc"))
                  for suffix in ("", "_Mainline", "_TBC", "_Vanilla", "_Wrath")}
    assert_tombstone(files, interfaces)


def test_each_retired_project_ships_only_its_tombstone(retired_built):
    # The last release of spoken-quests, spoken-zones and spoken-books: the old folder, under
    # every .toc name it had on Blizzard's clients, each with the Interface line the same client
    # reads from the renamed module, and nothing else.
    version = version_of(PLAYER_DIR, PLAYER)
    assert set(retired_built) == {f"{old}-{version}.zip" for old in RETIRED}
    for old, (new, suffixes) in RETIRED.items():
        names, files = retired_built[f"{old}-{version}.zip"]
        assert {name.split("/", 1)[0] for name in names} == {old}, names
        interfaces = {f"{old}{suffix}.toc": interface_of(os.path.join(REPO, "addons", new, f"{new}{suffix}.toc"))
                      for suffix in suffixes}
        assert_tombstone(files, interfaces, old)
        text = files[f"{old}/{old}.toc"].decode()
        assert f"## Version: {version}\n" in text
        assert "(now in Spoken)" in text


def test_the_shared_layout_is_the_same_file_in_every_addon():
    # UI/Layout.lua is carried by each addon rather than shared at runtime: they install
    # separately, and the player is only an optional dependency of the other two. Carrying
    # it is only safe while the copies agree, which nothing but this enforces.
    import hashlib
    copies = {}
    for addon in ("Spoken", "Spoken_Quests", "Spoken_Gossip", "Spoken_Zones", "Spoken_Books", "Spoken_Developer"):
        path = os.path.join(REPO, "addons", addon, "UI", "Layout.lua")
        assert os.path.isfile(path), f"{addon} is missing its copy of UI/Layout.lua"
        with open(path, "rb") as handle:
            copies[addon] = hashlib.sha256(handle.read()).hexdigest()
    assert len(set(copies.values())) == 1, f"UI/Layout.lua differs between addons: {copies}"


def test_the_compendium_files_are_the_same_in_every_addon_that_carries_them():
    # Azeroth's Compendium (UI/Compendium.lua) and the text view its pages scroll in
    # (UI/TextView.lua) are carried by Spoken Zones and Spoken Books for the reason UI/Layout.lua
    # is: either installs on its own, and both together share one window.
    import hashlib
    for name in ("Compendium.lua", "TextView.lua"):
        copies = {}
        for addon in ("Spoken_Zones", "Spoken_Books"):
            path = os.path.join(REPO, "addons", addon, "UI", name)
            assert os.path.isfile(path), f"{addon} is missing its copy of UI/{name}"
            with open(path, "rb") as handle:
                copies[addon] = hashlib.sha256(handle.read()).hexdigest()
        assert len(set(copies.values())) == 1, f"UI/{name} differs between addons: {copies}"
