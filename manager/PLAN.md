# Spoken Manager: plan

A small app for Windows, macOS and Linux that installs and updates Spoken and its voice packs. Open it, see what is
installed and what is new, press a button. No account, no login, no store.

Built from scratch. The AI VoiceOver manager was looked at for what it offers (game list,
per-game addon page, voice-pack browser, "in development" list, patch notes), not for its code.
This one keeps the parts a player needs and drops the rest (Patreon login, YouTube, collector,
reports, CurseForge catalog, other addons).

## What it does

1. Finds the World of Warcraft installs Spoken runs on (Forever, Classic Era, Anniversary) and lets
   the player add a folder by hand. Retail, Classic, the PTRs and betas are never listed.
2. For each install, shows whether Spoken is installed, which version, and whether a newer one
   exists on GitHub.
3. Installs, updates, repairs and removes Spoken (one zip: Spoken and its modules).
4. Lists the voice packs by language (Quests, Places, Readables), with sizes, and installs,
   updates and removes them. Packs are 0.3 to 1.5 GB, so downloads resume and show progress.
5. Shows what is new (the release notes) before updating.
6. Keeps itself up to date.

It never writes to `WTF`, saved variables, or any folder it did not install. With Sharing on (opt-in,
asked once at the first start) it reads `SavedVariables/SpokenContributions.lua` of each account and
sends the lines Spoken collected to the site (`src/main/share.ts`, README "Sharing").

## Where the files come from

GitHub Releases of `rusty-key/spoken-wow` (public, no token). Product tags, from
`scripts/lib/packs.mjs`:

| Product | Tag | Asset | Folders |
| --- | --- | --- | --- |
| Spoken | `spoken/vX.Y.Z` | `Spoken-X.Y.Z.zip` | `Spoken`, `Spoken_Conversations`, `Spoken_Places`, `Spoken_Readables`, `Spoken_Bosses`, `SpokenContributions` |
| Quests voices, English, all | `quests-audio/vX` | `SpokenQuestsAudioAll-X.zip` (1.4 GB) | the four split folders |
| Quests voices, English, split | `quests-audio-{alliance,horde,shared,gossip}/vX` | | `SpokenQuestsAudio<Side>` |
| Quests voices, a language | `quests-audio-<lang>/vX` | | `SpokenQuestsAudio_<lang>` |
| Places voices | `places-audio[-<lang>]/vX` (`zones-audio[-<lang>]/vX` before the rename) | `SpokenPlacesAudio[_<lang>]-X.zip` | `SpokenPlacesAudio[_<lang>]` |
| Readables voices | `readables-audio[-<lang>]/vX` (`books-audio[-<lang>]/vX` before) | | `SpokenReadablesAudio[_<lang>]` |

A pre-release (`-alpha`, `-beta`) is offered only when "Include pre-releases" is on. The manager
reads the installed version from each folder's `.toc` (`## Version:`) and keeps its own record of
what it put where (`state.json`), so removing a pack removes exactly its folders.

The catalog (which products exist, in which languages, with which folders) is a table in the
app. The versions, sizes, notes and download URLs come from the GitHub API at run time, cached
by ETag so the unauthenticated limit (60 requests an hour) is not a problem. Offline, the app
opens with the last catalog and says so.

## Which games

From `publishers/spoken/spoken.md`: Spoken is made and tested on Forever (`_forever_`) and
installs on Classic Era (`_classic_era_`) and Anniversary (`_anniversary_`). Those three are
`SUPPORTED_FLAVORS` in `src/shared/types.ts`, and the only ones the scan looks for. Any other
flavor folder (Retail, Classic, PTRs, betas) is not listed; adding one by hand is refused with
"Spoken runs on WoW: Forever, Classic Era and Anniversary. <folder> is not one of them.", and a
saved game of such a flavor from an earlier run is dropped on load (nothing on disk is touched).
The service keeps a cheap refusal as a second check.

## Community voice packs

A COMMUNITY page lists voice packs players made. The list is `community/packs.json` in the repo
(`CommunityPack` in `src/shared/types.ts`), fetched from
`https://raw.githubusercontent.com/rusty-key/spoken-wow/master/community/packs.json`, ETag-cached,
and kept offline. A player shares a pack by opening a pull request that adds an entry, so a
maintainer has looked at it; `community/README.md` says how.

- Product id `community/<pack id>`, installed as the one folder `SpokenCommunity_<pack id>`. It never
  replaces an official pack's folder.
- The registry is untrusted input: ids, folders, urls and sizes are validated; the url must be an
  https GitHub release asset; `sha256` is required and checked after the download.
- The zip may hold only that one folder. A pack carries Lua, so the page says so before the first
  install ("Packs from the community are not made or checked by Spoken's authors").
- Rows show title, author, language, section, size, version, license, a link to the author's page,
  and Install / Update / Remove, filtered by language and section.
- Spoken does not load these folders yet: its pack discovery knows the official names only.
  That is addon work, tracked in `spoken-later.txt`. Until then the page says "Needs a newer Spoken to play these".

## Site map

```
Spoken Manager
|- HOME
|    My games: one card per install (name, game version, Spoken status, voice packs, button)
|    What's new: the latest Spoken release notes
|    Empty state: "No World of Warcraft found" + Add folder
|- SPOKEN                      (per game: a game picker at the top of the left rail)
|    Left rail: game picker, installed version, channel, Install / Update, menu (open folder,
|               repair, remove), install path
|    Tabs: Modules (each folder and its state) | Changelog (every release, newest first)
|- VOICE PACKS                 (per game)
|    Language chips; sections Quests, Places, Readables; a row per pack (size, installed
|    version, state, Install / Update / Remove, progress); "Install everything in <language>"
|- COMMUNITY                    (per game)
|    Packs from players: filters, a row per pack, a notice about who made them, "Share your pack"
|- SETTINGS
|    Game folders (list, Add, Remove, Rescan)
|    Updates (include pre-releases, check on start, manager auto-update)
|    Downloads (cache folder, keep downloaded zips)
|    Sharing (send what Spoken collects, last sent, send now, reset id)
|    About (versions, links, open log folder)
```

Top bar, as in Battle.net: logo at the left, uppercase tabs with a blue underline on the active
one, a refresh button and the manager version at the right. Dark navy window, blue primary
button, yellow for "update available", green tick for "up to date", muted grey for "not
installed". No Blizzard art or logos: the cards use the Spoken icon on a gradient.

## Architecture

Electron, TypeScript, React, built with electron-vite, packaged with electron-builder (NSIS
installer, per-user, no admin) and updated with electron-updater from GitHub Releases
(`manager/vX` tags). Electron because the reference is one, the repo is Node already, and a
download manager with a UI needs nothing the platform lacks.

```
manager/
  src/shared/      types and the IPC contract (the one file both sides import)
  src/main/        main process
    games.ts         discover installs; read .build.info / .flavor.info; persist added folders
    github.ts        releases, ETag cache, rate-limit handling
    catalog.ts       the product table; resolve latest release and asset per product
    download.ts      resumable download to a .part file, progress, size and digest check
    install.ts       extract (zip-slip safe), stage, swap, back up, roll back, uninstall
    guard.ts         refuse junctions and symlinks, warn when the game is running, disk space
    state.ts         state.json (what was installed where), settings.json
    ipc.ts           the handlers
    updater.ts       the manager's own update
  src/preload/     contextBridge: the typed api, nothing else
  src/renderer/    React: pages, components, one small store
  tests/           vitest: discovery, catalog, download, install, guard
```

Rules the installer keeps:

- A folder that is a junction or a symlink is a developer's checkout: refuse, say so, never
  replace it. (This machine has one: `AddOns\spoken-wow` and the Spoken folders link into a
  repo.)
- Extract to `AddOns\.spoken-manager\staging\<id>`, then move each folder in. The old folder
  moves to `.spoken-manager\backup\<id>` first and comes back if anything fails. Every step is
  written to `staging\journal.json` first, so a crash is undone at the next start (and before the
  next job). The backup that stays after a successful job is that job's own; every other product's
  backup on that game is deleted then. If a rollback fails, the error names the backup folder and
  the next change on that game is refused until it is restored.
- A zip is read before it is unpacked: official packs may unpack to 6 GB in 200,000 files,
  community packs to 2 GB in 20,000.
- A resume sends `If-Range` with the ETag or date saved beside the `.part`; if the server answers
  200 the download starts again. The downloaded file is named by game, so two games never share one.
- At start: interrupted swaps are undone, `staging` is emptied, and `.part` files nobody resumed
  for a week are removed. Quitting with a job running stops it and waits for its rollback.
- Zip entries are checked: no `..`, no absolute paths, nothing outside the allowed folder
  names for that product.
- A download is a `.part` file with a `Range` resume; done only when the size matches and, when
  GitHub gives a `sha256` digest for the asset, the digest matches.
- Free space is checked before a download (size plus the extracted size).
- If the game is running (`tasklist` on Windows, `ps` on macOS and Linux), installing is allowed but says "reload or restart the game".
- Nothing runs elevated. A game folder the user cannot write to is reported with the reason.

## Phases

1. Core and contract: types, discovery, GitHub, catalog, download, install, guard, state, with tests.
2. Window: shell, navigation, Home, Spoken, Voice Packs, Settings, in the Battle.net style.
3. Polish: empty and error states, offline, progress and cancel, keyboard focus, high-DPI.
4. Package: icon, installers for the three systems, auto-update, a release workflow for `manager/v*` tags.

Out of scope for now: other addons, a login, translations of the manager itself (English
first; strings are in one file so the languages can follow), anything that sends data anywhere.

## Manager releases

A tag `manager/vX.Y.Z` builds the installers for the three systems, publishes them as that tag's
release, and refreshes the `manager-latest` release (`latest.yml`, `latest-mac.yml`,
`latest-linux.yml` and the installers, replaced each time) so installed managers can update. They read it through electron-updater's generic provider at
`https://github.com/rusty-key/spoken-wow/releases/download/manager-latest`, not the GitHub
provider, because the GitHub provider takes the repo's newest release and that is usually a
`spoken/` or `*-audio/` tag. The workflow is `.github/workflows/manager.yml` (separate from
`ci.yaml`): a test job and a package job on Windows, macOS and Linux, and a release job that runs
only for tags. It checks that the tag matches `version` in `package.json`. A tag with a `-` in it
(`manager/v0.2.0-beta.1`) is published as a pre-release and leaves `manager-latest` alone. The
first run creates `manager-latest` as a normal release that is not marked "latest", so the repo's
"latest" stays Spoken's own.

## Checks

`npm test` (vitest) for the core, `npm run typecheck`, and a manual pass in the running window
with a throw-away AddOns folder. Not part of the repo's `ci.yaml` or its pnpm workspace: the manager
has its own `package-lock.json`, its own folder, `manager/`, and its own workflow, `manager.yml`,
which runs typecheck, tests and build on Windows, macOS and Linux.

The tests run the logic of every system on any machine: discovery, case rules, the running-game
check and the updater take the platform (and the home folder) as parameters, and the tests pass a
temp folder as the root of the disk. What they cannot show is the real system: see the end of
"Platforms".

## Platforms

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installer | NSIS, x64 | dmg and zip, Intel and Apple silicon | AppImage, tar.gz, deb and rpm, x64 |
| Finds the game | registry, Battle.net list, default folders, every fixed drive | /Applications, ~/Applications, /Volumes | Wine prefixes: Wine, Lutris, Bottles, Steam (Proton), Heroic |
| Game running | `tasklist` | `ps` | `ps`, also sees Wine's Wow.exe |
| Manager update | by itself | a link to the download page | by itself in an AppImage, else a link |
| Window | no frame, page draws the buttons | system buttons inset in the top bar | no frame, page draws the buttons |
| Letter case in paths | ignored | ignored | matters |
| Data and logs | `%APPDATA%\Spoken Manager` | `~/Library/Application Support/Spoken Manager` | `~/.config/Spoken Manager` |

Logs are in `logs/manager.log` inside the data folder.

### Finding the game

Every discovery function takes the platform and the home folder as parameters (default: the running
system), so the tests run all three on one machine.

- Windows: as before (registry keys, Battle.net's `product.db`, `Program Files`, each fixed drive).
- macOS: `/Applications/World of Warcraft`, `~/Applications/World of Warcraft`, and for every
  folder in `/Volumes` its `World of Warcraft` and `Applications/World of Warcraft`. The startup disk
  is also listed in `/Volumes`; a folder reached twice counts once. Battle.net's list at
  `/Users/Shared/Battle.net/Agent/product.db` is read too. A flavor folder holds
  `World of Warcraft*.app`, which counts as a game marker next to `Interface`, `WTF` and `Wow*.exe`.
- Linux: the game runs under Wine, so the search is for a Wine prefix (a folder with `drive_c`) and
  then `drive_c/Program Files (x86)/World of Warcraft` or `drive_c/Program Files/World of Warcraft`.
  Prefixes: `$WINEPREFIX`, `~/.wine`, `~/Games/*`, `~/.local/share/bottles/bottles/*`, the Flatpak
  Bottles and Lutris data folders, `~/.local/share/lutris/*` (not `runners`), Steam's
  `steamapps/compatdata/*/pfx` (also the Flatpak and `~/.steam` copies), `~/Games/Heroic/Prefixes/*`
  and `default/*`. No recursion, every read error ignored, and the whole search stops after 4
  seconds. A game in a place not listed is added with the folder picker.

### Letter case and links

- Paths are compared without regard to case on Windows and macOS and exactly on Linux (`samePath`,
  `isInside`, game ids, the downloads folder check, the page trust check).
- `Interface/AddOns` and `WTF` are looked up by listing the folder when the exact name is missing,
  so `interface/addons` on Linux is used as it is. When the folders are missing they are created
  as `Interface/AddOns`.
- A symlink (macOS, Linux) or a junction (Windows) in the AddOns folder is refused with the usual
  message ("This folder is linked to a development checkout"). The same goes for an AddOns or
  Interface folder that is itself a link.

### Manager updates

Windows (NSIS), macOS (from the zip; the build is signed, which the Mac updater requires) and a
Linux AppImage (the `APPIMAGE` variable is set) download the update and install it when the
manager quits. Linux outside an AppImage (the tar.gz) has nothing to download into, and
electron-updater does not even check there. There the manager does not use electron-updater: it
fetches `latest-linux.yml` from the feed, compares its
`version:` with its own, and when the feed is newer shows "available" with a link to
`https://github.com/rusty-key/spoken-wow/releases/tag/manager-latest`. Failures are silent at start
and shown when the player asks for a check.

### Signing and first start

The macOS build is signed with a Developer ID certificate and notarized in CI (the `MAC_CSC_LINK`,
`MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` secrets). The
Linux and Windows builds are not signed. When Apple refuses to notarize, CI ships the Mac build
signed only, with a warning on the run; macOS then asks the player to choose Open Anyway once.

- macOS: open the dmg, drag the app to Applications. 0.1.1 and older were unsigned, and macOS calls
  them damaged; `xattr -dr com.apple.quarantine "/Applications/Spoken Manager.app"` opens one.
- Linux AppImage: `chmod +x Spoken-Manager-*-linux.AppImage`, then run it. On Ubuntu 24.04 and
  later AppArmor can block the browser sandbox of an Electron app and the window never opens. Start it
  as `./Spoken-Manager-*-linux.AppImage --no-sandbox`; this turns the Chromium sandbox off for that
  run, so use it only until a proper profile or a .deb exists.
- Windows: the installer is not signed either; SmartScreen may ask once.

### Not yet checked on a real machine

Written and tested with temp folders on Windows only.

- macOS: that a signed build updates itself from the zip; the traffic
  lights against the 68 px bar; Cmd+Q, Cmd+C, Cmd+V; the Dock click opening the window again; what
  `ps` prints for the game; Battle.net's product list on a Mac.
- Linux: that the AppImage starts and updates itself; the frameless window with the page's own
  buttons under X11 and Wayland; every prefix location in the table; `ps` output under Wine.
- The release workflow has not run yet. The first `manager/v*` tag is its test, and it creates
  `manager-latest` on that run.
