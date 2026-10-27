# Spoken Manager

A small app for Windows, macOS and Linux that installs and updates the Spoken addon and its voice
packs for World of Warcraft: Forever, Classic Era and Anniversary. It finds your game, shows what
is installed and what is new, and installs, updates or removes it with one button. It has no
account and no login. The network traffic is GitHub (the release list, Spoken and the manager's
own updates) and spoken-packs.rusty.one (the voice packs, updated file by file), plus, only when
you turn on Sharing, spoken.rusty.one (see [Sharing](#sharing)).

The plan and the rules the installer follows are in [PLAN.md](PLAN.md).

## Install

Download the file for your system from the newest release named `manager-latest` or
`manager/v...` on the [releases page](https://github.com/rusty-key/spoken-wow/releases).

Windows: run `Spoken-Manager-Setup-<version>.exe`. If SmartScreen asks, choose "More info", then
"Run anyway". The manager updates itself after that.

macOS: open `Spoken-Manager-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel) and
drag the app to Applications. The app is signed and updates itself from there. If macOS says it
cannot verify the app, open System Settings → Privacy & Security and choose Open Anyway (once).
Version 0.1.1 and older were not signed: macOS calls them damaged. Run this once in Terminal to
open one, or download the newest version instead:

    xattr -dr com.apple.quarantine "/Applications/Spoken Manager.app"

Linux: download `Spoken-Manager-<version>-linux.AppImage`, make it runnable and start it:

    chmod +x Spoken-Manager-*-linux.AppImage
    ./Spoken-Manager-*-linux.AppImage

The AppImage updates itself. On Ubuntu 24.04 and later the AppImage's window may not open because
AppArmor blocks the browser sandbox. Start it with `--no-sandbox` in that case; this turns the
sandbox off for that run. The `.deb` and `.rpm` set up the sandbox when they install and do not
need it. Debian/Ubuntu users can install the `.deb` with `sudo apt install ./Spoken-Manager-*-linux.deb`;
Fedora users can install the `.rpm` with `sudo dnf install ./Spoken-Manager-*-linux.rpm`. The
`.tar.gz`, `.deb` and `.rpm` builds work without the AppImage updater and should be updated through
their package manager or by downloading a newer release.

## Where it looks for the game

Windows: the registry, Battle.net's install list, the usual `Program Files` folders and every fixed
drive.

macOS: `/Applications/World of Warcraft`, `~/Applications/World of Warcraft` and the same two
places on every mounted volume.

Linux: the game runs under Wine, so it looks inside Wine prefixes: `$WINEPREFIX`, `~/.wine`,
`~/Games/*`, and the prefixes of Lutris, Bottles, Steam (Proton) and Heroic.

If your game is somewhere else, press "Add Game Folder" and choose it. You can choose the game
folder, one of its `_classic_era_`, `_classic_beta_` or `_anniversary_` folders, or the
`Interface/AddOns` folder.

## Run it from source

You need Node 22 and npm. Work in this folder (`manager/`):

    npm ci
    npm run dev          # the app, with live reload
    npm run dev:web      # only the window in a browser, with made-up data, for design work
    npm test             # unit tests
    npm run typecheck

## Build the installers

Each installer is built on its own system, because electron-builder cannot make a macOS app on
Windows or Linux:

    npm run dist:win     # on Windows: release/Spoken-Manager-Setup-<version>.exe
    npm run dist:mac     # on macOS: .dmg and .zip for x64 and arm64
    npm run dist:linux   # on Linux: .AppImage and .tar.gz

The files and the `latest*.yml` update feed files land in `release/`. Releases are built by GitHub
Actions (`.github/workflows/manager.yml`) when a tag like `manager/v0.1.0` is pushed.

## Where it keeps its data

The data folder holds the settings, the record of what was installed, the downloads and the log:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Spoken Manager` |
| macOS | `~/Library/Application Support/Spoken Manager` |
| Linux | `~/.config/Spoken Manager` |

The log is `logs/manager.log` in that folder, and the last older log is `manager.log.1`. The
manager also keeps a hidden `.spoken-manager` folder inside each game's `Interface/AddOns` folder
for working files and for the backup of what an update replaced. It never writes to `WTF` or to any
addon it did not install. With Sharing on it reads one file there, below. `share.json` in the data
folder is Sharing's: the manager's random id and a fingerprint of each line already sent.

## Sharing

Spoken keeps every quest, gossip and book line it had no voice for in
`WTF/Account/<account>/SavedVariables/SpokenContributions.lua`. You can upload that file at
spoken.rusty.one/contribute, or let the manager send it: the first time it starts it asks, and
Settings > Sharing changes the answer. It is off until you say yes.

With Sharing on, the manager reads that file of each account of each game (it never writes it)
when it starts and every five minutes after, and sends the lines it has not sent before. The game
writes the file when you log out or type `/reload`. What is sent: the collected lines as Spoken
wrote them (the text on screen, the quest or NPC, the game's version, the language and version of
your voice packs) and a random id the manager made for itself, which Settings can replace. Nothing
about your Battle.net account or your characters is in it. The site uses lines it does not have to
add them, and counts the ones it has but your pack could not play, to know what to voice next.
