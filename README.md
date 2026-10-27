# Spoken

Discord: https://discord.gg/HEGUgn6Yf

Voiced dialogue, lore and text for World of Warcraft Forever. The other clients' code is
still here, with no new work going into it.

Spoken is one download: Spoken itself and its three modules, Spoken Quests, Spoken Places and
Spoken Readables. Each is a folder of its own, grouped under Spoken in the
AddOns list. Spoken plays every line and owns the settings page, the minimap button, the queue
and the narrator window or subtitles; each module reads one kind of text and has a page of its
own under Spoken's settings. Every module comes installed. A player who does not want one
switches it off on its card on Spoken's page, disables it in the AddOns list, or deletes its
folder. The voice packs are separate downloads. `Spoken_Developer`, the debug log, is for
developers and is not in the zip.

| Folder | Addon | Voices | Voice packs |
|---|---|---|---|
| `Spoken` | **Spoken** | nothing itself: it plays every module's lines | — |
| `Spoken_Quests` | **Spoken Quests** | quest dialogue and NPC gossip | [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all), or [Alliance](https://www.curseforge.com/wow/addons/spoken-audio-quests-alliance) · [Horde](https://www.curseforge.com/wow/addons/spoken-audio-quests-horde) · [Shared](https://www.curseforge.com/wow/addons/spoken-audio-quests-shared) · [Gossip](https://www.curseforge.com/wow/addons/spoken-audio-gossip) — or all in one from [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=quests-audio) |
| `Spoken_Readables` | **Spoken Readables** | books, letters and other in-world texts | [CurseForge](https://www.curseforge.com/wow/addons/spoken-audio-readables) · [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=readables-audio) |
| `Spoken_Places` | **Spoken Places** | zone and subzone lore | [CurseForge](https://www.curseforge.com/wow/addons/spoken-audio-places) · [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=places-audio) |

`make package-spoken` builds the download, `Spoken-<version>.zip`, with every module built by
its own packager. A module's voice pack holds its recordings; the module has nothing to play
without one, and the pack does nothing without the module.

The sound packs are not on Wago. Each is 280 to 452 MB and Wago's upload endpoint refuses a
file this size, so a pack comes from CurseForge or from a GitHub release, one tag per pack,
`<pack>/vX.Y.Z`. English quests are the four split packs on CurseForge, and the same four in
one `quests-audio` zip on GitHub. `scripts/audio-github-release.sh` cuts the release from the
machine that built the audio, since the audio is outside git and no runner can rebuild it.

On the stores, `spoken` is Spoken and ships the zip above, and `spoken-english` is a meta addon
that pulls in Spoken and every English voice pack. `spoken-quests`, `spoken-zones` and
`spoken-books` are retired. Each has a page in `publishers/` that says so.
The module folders were `SpokenQuests`, `SpokenZones` and `SpokenBooks` until 3.0.0-beta.3,
and those names belong to the retired projects, so the modules moved to `Spoken_Quests`,
`Spoken_Places` and `Spoken_Books`; Spoken_Books has since become `Spoken_Readables`. The voice
packs name Spoken as their dependency. Folders an older release left behind (`SpokenPlayer`,
`VoiceOverRedux`, `ZoneLore`, and a full old copy of a module under its old name) are found at
login, and the player is asked to delete them.

## What players see

**Narrator styles.** Spoken shows a line in one of four ways, five with DialogueUI, chosen
on the Spoken settings page or in the welcome window on first login:

- **Subtitles Only**, the default unless DialogueUI is installed: the speaker's name
  and the words low in the middle of the screen over a soft shadow, at most four lines at a
  time. A longer line turns its pages as the voice reaches them, one fading out before the
  next fades in. The words show whole, with the word being read lit; Type Words Out in the
  settings types them in instead, a little ahead of the voice. Stop or Replay, skip and Report
  appear on hover.
- **Small Window** (Minimal Classic): a round portrait, the speaker's name and the title (a
  slim progress bar under them with Show Progress Bar on), with the controls and the queue on
  interaction. See [`docs/minimal-classic/`](docs/minimal-classic/README.md).
- **Large Window**: the game's Talking Head frame where the client has its art: a bigger
  portrait, with the speaker's name, the words, the controls and a count of the lines waiting
  beside it in one box.
- **DialogueUI**, offered only with the [DialogueUI](https://www.curseforge.com/wow/addons/dialogueui)
  addon installed: a smaller twin of its quest window, in its own parchment or dark art. See
  [`docs/spoken/PLAYER-STYLES.md`](docs/spoken/PLAYER-STYLES.md).
- **Voice Only**: nothing on screen.

The windows can show the words as caption lines too, with the words being read lit in gold
(Highlight Words, on by default); see [caption controls](docs/spoken/CAPTIONS.md). Word
timing is an estimate, because the recordings do not mark where each word falls. The
subtitles light a word only while Highlight Words is on and Type Words Out is off, since a
word lit as it is typed shows every miss.

**Languages.** Menus, settings and messages follow the game's text language: English,
German, Spanish, French, Korean, Brazilian Portuguese, Russian and both Chinese scripts. The
language the voices speak is a separate choice, Voice Language on Spoken's page: Auto follows
the game, and a language is heard only when its voice pack is installed.

**Settings** follow the game's own settings pages: a fixed header with Defaults, sections
and rows laid out as Blizzard's are, the game's checkboxes, sliders and dropdowns. The
Spoken page opens with a card per module (on or off, its voice packs as a progress bar, a
button to its page), then the narrator style as pictures, the voice language, the sound, the
keys, a Fix a Problem section and the finer settings. Profiles switch the settings of Spoken
and every module together; Places and Readables keep theirs inside Spoken's profile. Each
module has a page of its own. Read in Battlegrounds, on by default, keeps Spoken quiet in
battlegrounds and arenas when switched off.

**Quests.** The quest log's details have Play and Report, the same round buttons the
subtitle uses; a quest with no recording offers Contribute in their place.

**Places.** The Place Story sits beside the world map, in a panel of its own, with the story of
the zone or area the map shows on the quest log's parchment, and Play, Report and a button
that opens it in Azeroth's Compendium. The Compendium opens from the minimap menu, `/sp
compendium` or `/spp window`. It browses every quest, every place story and every readable, with
a search box, and plays any of them without going there. Places follows Spoken's Voice
Language.

**Defaults on a first install:** every module on; the DialogueUI window when a DialogueUI
Spoken recognises is installed, otherwise Subtitles Only (a player who never picked a style
follows the same rule on each login); Show Narrator and Type Words Out on, by letters, Highlight Words off; subtitle size 100% and its shadow at 60%; the voice in
the game's language with English for a missing line; volume on Master; NPC voices silenced
while a line plays; other sounds turned down (music 30%, ambience 40%, effects 60%); missing
lines collected for contributing; the minimap button shown, unlocked and in the AddOns menu;
no keys bound.

## Layout

```
addons/      Spoken, its modules, and the sound packs
apps/web     the site, spoken.rusty.one: quests, gossip, zones and books sections,
             per-line reports and /contribute for text the corpus has none of yet
pipelines/   corpus extraction and voiceline generation
             quests/ is Python, zones/ and books/ are Node, lib/ is shared
publishers/  the store pages, one markdown file per project
scripts/     packaging, release and description tooling
deploy/web   the droplet: nginx, pm2, release scripts and the runbook
tests/lua/   the luajit addon harness
make/        one Makefile per project; the root Makefile dispatches
docs/        each section's own prose
```

## Working here

`make help` lists what is available. Targets are prefixed by project:

```
make web-<target>       # see make/web.mk   -- the site and its droplet
make quests-<target>    # see make/quests.mk
make places-<target>     # see make/places.mk
make readables-<target>     # see make/readables.mk
make test-player        # the Lua harness, all addons
make lint               # the repo-wide checks
```

`THIRD_PARTY.md` says what in here is not this project's, and under what terms: the
vendored libraries, the game text the corpus is built from, and the wiki lore and
pictures the Places addon ships.

## Credits

Most of Forever's text that the world database lacks comes from players, through `/contribute`.
The text of a few Forever quests that nobody has sent yet, some BroadcastText rows, and the quest
data behind the Compendium come from Efficient Games (https://efficient.games), published as
[EG Link output](https://github.com/JIVESCORP/eg-link-output-wowf) under CC BY 4.0. The text
itself is Blizzard's. `THIRD_PARTY.md` lists the rest.

Read `AGENTS.md` before changing anything, and the section READMEs under `docs/`
for what each section does. They are detailed, and they are the reference to check
before inferring behaviour from the code.

## History

This repository began as the merge of two that came before it, imported with their
full history:

- `rusty-key/wow-voiceover` — now `quests`
- `rusty-key/wow-zone-lore` — now `zones`

`git log --follow` works across the move. Tags from the first are prefixed
`legacy/quests/` because they predate the addon they would otherwise appear
to name.
