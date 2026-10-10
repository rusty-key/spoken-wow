# Spoken

Discord: https://discord.gg/HEGUgn6Yf

Voiced dialogue, lore and text for World of Warcraft Classic.

**Spoken** is one download: Spoken itself and its three modules, Spoken Quests, Spoken
Books and Spoken Zones. Each is a folder of its own, grouped under Spoken in the AddOns
list. Spoken plays every line and owns the settings page, the minimap button, the queue and
the narrator window or subtitles; each module voices one kind of text and has a page of its
own under Spoken's settings. Every module comes installed. A player who does not want one
switches it off on its card on Spoken's page, disables it in the AddOns list, or deletes its
folder. The voice packs are separate downloads.

| Folder | Addon | Voices | Voice packs |
|---|---|---|---|
| `Spoken` | **Spoken** | nothing itself: it plays every module's lines | — |
| `Spoken_Quests` | **Spoken Quests** | quest dialogue and NPC gossip | [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all), or [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) · [Horde](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde) · [Shared](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared) · [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) — or all in one from [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=quests-audio) |
| `Spoken_Books` | **Spoken Books** | books, letters and other in-world texts | [CurseForge](https://www.curseforge.com/wow/addons/spoken-books-audio) · [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=books-audio) |
| `Spoken_Zones` | **Spoken Zones** | zone and subzone lore | [CurseForge](https://www.curseforge.com/wow/addons/spoken-zones-audio) · [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=zones-audio) |

`make package-spoken` builds the download, `Spoken-<version>.zip`, with every module built by
its own packager. A module's voice pack holds its lines; the module does nothing without one,
and the pack does nothing without the module.

**The sound packs are not on Wago**: each is 280–452 MB and that upload endpoint refuses a
file this size, so a pack comes from CurseForge or from a GitHub release — one tag per pack,
`<pack>/vX.Y.Z` (English quests are the four split packs on CurseForge, and the same four in
one `quests-audio` zip on GitHub), cut by `scripts/audio-github-release.sh` from the machine
that built the audio, since the audio is outside git and no runner can rebuild it.

The 1.12, 2.4.3 and 3.3.5 clients have no addon manager and no CurseForge. They take Spoken
Quests' own zips from [Releases](../../releases), which carry Spoken inside them; the other
modules do not run there.

**On the stores today** the addons are still separate projects: `spoken-player` (Spoken),
`spoken-quests`, `spoken-zones`, `spoken-books`, and `spoken`, a stub that pulls all of them
in. The move to one download: `spoken-player` becomes Spoken and ships the zip above, so
everyone who has it gets the modules with their next update; `spoken-quests`, `spoken-zones`,
`spoken-books` and `spoken` retire, and their last release stops shipping the module folders;
the voice packs name Spoken as their dependency. The modules' folders were `SpokenQuests`,
`SpokenZones` and `SpokenBooks` until 3.0.0-beta.3; those names belong to the retiring projects,
so the modules moved to `Spoken_Quests`, `Spoken_Zones` and `Spoken_Books`, and each retiring
project's last release (`make package-spoken-retired`) replaces its old folder with a tombstone
that never loads. Folders an older release left behind (`SpokenPlayer`, `VoiceOverRedux`,
`ZoneLore`, and a full old copy of a module under its old name) are found at login, and the
player is asked to delete them.

## What players see

**Narrator styles.** Spoken shows a line in one of four ways, five with DialogueUI, chosen
on the Spoken settings page or in the welcome window on first login:

- **Subtitles Only**, the default on the modern clients: the speaker's name and the words
  low in the middle of the screen over a soft shadow, at most four lines at a time. A longer
  line turns its pages as the voice reaches them, one fading out before the next fades in.
  The words type in letter by letter (or whole words, in the settings), a little ahead of the
  voice. Stop or Replay, skip and Report appear on hover.
- **Small Window** (Minimal Classic): a round portrait, the speaker's name, the title and a
  slim progress bar, with the controls and the queue on interaction. See
  [`docs/minimal-classic/`](docs/minimal-classic/README.md).
- **Large Window**: the original layout, with the lines waiting to play next. The 1.12,
  2.4.3 and 3.3.5 clients start in this one; 2.4.3 and 3.3.5 can switch to Subtitles Only.
- **DialogueUI**, offered only with the [DialogueUI](https://www.curseforge.com/wow/addons/dialogueui)
  addon installed: a smaller twin of its quest window, in its own parchment or dark art. See
  [`docs/spoken/PLAYER-STYLES.md`](docs/spoken/PLAYER-STYLES.md).
- **Voice Only**: nothing on screen.

The windows can show the words as caption lines too, with the words being read lit in gold
(Highlight Words); see [caption controls](docs/spoken/CAPTIONS.md). Word timing is an
estimate, because the recordings do not mark where each word falls, so the subtitles do not
light words.

**Languages.** Menus, settings and messages follow the game's text language: English,
German, Spanish, French, Korean, Brazilian Portuguese, Russian and both Chinese scripts. The
language the voices speak is a separate choice, Voice Language on Spoken's page: Auto follows
the game, and a language is heard only when its voice pack is installed.

**Settings** follow the game's own settings pages: a fixed header with Defaults, sections
and rows laid out as Blizzard's are, the game's checkboxes, sliders and dropdowns. The
Spoken page has a card per module (on or off, its voice packs as a progress bar, a button to
its page), the narrator styles as pictures, and Profiles, which switch Spoken's and the
Quests module's settings together. Each module has a page of its own.

**Quests.** The quest log's details have Play and Report, the same round buttons the
subtitle uses; a quest with no recording offers Contribute in their place.

**Zones.** *Zone Lore* sits beside the world map, in a panel of its own, with the story of
the zone or area the map shows on the quest log's parchment, and Play, Report and a button
that opens it in *Lore of Azeroth*. That window, from the minimap menu or `/spz window`,
browses every story: Azeroth, its two continents, their zones and each zone's areas, with a
search box.

**Defaults on a first install:** every module on; Subtitles Only; Show Words and Type Words
Out on, by letters, Highlight Words off; subtitle size 100% and its shadow at 60%; the voice in
the game's language with English for a missing line; volume on Master; NPC voices silenced
while a line plays; other sounds turned down (music 30%, ambience 40%, effects 60%); missing
lines collected for contributing; the minimap button shown, unlocked and in the AddOns menu;
no keys bound.

**Everyone starts fresh** with this release, updating players too. The settings files have
new names and nothing is read from older ones, so the welcome window opens at first login to
choose a setup. Lines collected for contributing are kept: they are in
`SpokenContributions.lua`, the file the contribute page asks for.

## Layout

```
addons/      Spoken, its modules, and the sound packs
apps/web     the site: spoken.rusty.one, with quests, zones and books sections,
             per-line reports and /contribute for text the corpus has none of yet
pipelines/   corpus extraction and voiceline generation
             quests/ is Python, zones/ and books/ are Node
deploy/web   the droplet: nginx, pm2, release scripts and the runbook
packages/    shared TypeScript
tests/lua/   the luajit addon harness
make/        one Makefile per project; the root Makefile dispatches
docs/        each project's own prose, until it is merged
```

## Working here

`make help` lists what is available. Targets are prefixed by project:

```
make web-<target>       # see make/web.mk   -- the site and its droplet
make quests-<target>    # see make/quests.mk
make zones-<target>     # see make/zones.mk
make books-<target>     # see make/books.mk
make test-player        # the Lua harness, all addons
```

`THIRD_PARTY.md` says what in here is not this project's, and under what terms —
the vendored Ace libraries, the game text the corpus is built from, and the wiki
lore the zones addon ships.

Read `AGENTS.md` before changing anything, and the project READMEs under
`docs/` for what each side actually does — both are unusually detailed and
both are the primary reference, not the code.

## History

This repository is the merge of two that came before it, imported with their
full history:

- `rusty-key/wow-voiceover` — now `quests`
- `rusty-key/wow-zone-lore` — now `zones`

`git log --follow` works across the move. Tags from the first are prefixed
`legacy/quests/` because they predate the addon they would otherwise appear
to name.
