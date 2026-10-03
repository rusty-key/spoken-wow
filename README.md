# Spoken

Discord: https://discord.gg/HEGUgn6Yf

Voiced dialogue, lore and text for World of Warcraft Classic. One platform,
several addons.

**Spoken (Bundled)** is what this repository builds today: the player (`SpokenPlayer`) and
its three modules, Quests (`SpokenQuests`), Zones (`SpokenZones`) and Readables
(`SpokenBooks`), used together. The player owns the settings page, the minimap button, the
queue and the narrator window or subtitles; each module adds its voices and a page of its
own under Spoken's settings, and switches on or off from Spoken's page.

Standalone versions of each module, such as **Spoken (Quests Standalone)**, are planned:
one module on its own, without the bundle around it. They do not exist yet, and nothing
below describes them.

| Addon | Voices | Install | Audio packs |
|---|---|---|---|
| **Spoken** | nothing — it *is* the player: the queue, the frame, the minimap button | [CurseForge](https://www.curseforge.com/wow/addons/spoken-player) · [Wago](https://addons.wago.io/addons/spoken-player) | — |
| **SpokenQuests** | quest dialogue and NPC gossip | [CurseForge](https://www.curseforge.com/wow/addons/spoken-quests) · [Wago](https://addons.wago.io/addons/spoken-quests) | [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all), or [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) · [Horde](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde) · [Shared](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared) · [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) — or all in one from [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=quests-audio) |
| **SpokenZones** | zone and subzone lore | [CurseForge](https://www.curseforge.com/wow/addons/spoken-zones) · [Wago](https://addons.wago.io/addons/spoken-zones) | [CurseForge](https://www.curseforge.com/wow/addons/spoken-zones-audio) · [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=zones-audio) |
| **SpokenBooks** | books, letters and other in-world texts | [CurseForge](https://www.curseforge.com/wow/addons/spoken-books) · [Wago](https://addons.wago.io/addons/spoken-books) | [CurseForge](https://www.curseforge.com/wow/addons/spoken-books-audio) · [GitHub](https://github.com/rusty-key/spoken-wow/releases?q=books-audio) |

The addons are on both stores under the same slugs. **The sound packs are not on Wago**: each
is 280–452 MB and that upload endpoint refuses a file this size, so a pack comes from
CurseForge or from a GitHub release — one tag per pack, `<pack>/vX.Y.Z` (English quests are the
four split packs on CurseForge, and the same four in one `quests-audio` zip on GitHub), cut by
`scripts/audio-github-release.sh` from the machine that built the audio, since the audio is
outside git and no runner can rebuild it.

A feature addon speaks; its audio pack holds the lines. Neither does anything alone,
so install both.

`make package-spoken-bundle` builds Spoken (Bundled) as one zip of the four addons, for a hand
install; the sound packs stay separate downloads.

Every feature addon plays through `SpokenPlayer`, so a player who installs two of
them gets one queue and one window rather than two of each. Addon managers
install it automatically; the legacy-client zips bundle it, because those
clients have no manager to do it for them. The 1.12, 2.4.3 and 3.3.5 clients have
no CurseForge either, and take their zips from [Releases](../../releases).

## What players see

**Narrator styles.** The player shows a line in one of four ways, chosen on the Spoken
settings page or in the welcome window on first login:

- **Subtitles Only**, the default on the modern clients: the speaker's name and the words
  low in the middle of the screen over a soft shadow, at most four lines at a time. A longer
  line turns its pages as the voice reaches them, one fading out before the next fades in.
  The words type in letter by letter (or whole words, in the settings), a little ahead of the
  voice. Play or pause, skip and Report appear on hover.
- **Small Window** (Minimal Classic): a round portrait, the speaker's name, the title and a
  slim progress bar, with the controls and the queue on interaction. See
  [`docs/minimal-classic/`](docs/minimal-classic/README.md).
- **Large Window**: the original layout, with the lines waiting to play next. The 1.12,
  2.4.3 and 3.3.5 clients start in this one; 2.4.3 and 3.3.5 can switch to Subtitles Only.
- **Voice Only**: nothing on screen.

The windows can show the words as caption lines too, with the words being read lit in gold
(Highlight Words); see [caption controls](docs/spoken/CAPTIONS.md). Word timing is an
estimate, because the recordings do not mark where each word falls, so the subtitles do not
light words.

**Settings** follow the game's own settings pages: a fixed header with Defaults, sections
and rows laid out as Blizzard's are, the game's checkboxes, sliders and dropdowns. The
Spoken page has a card per module (on or off, its voice packs as a progress bar, a button to
its page), the narrator styles as pictures, and Profiles, which switch the player's and the
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

## Layout

```
addons/      the player, the feature addons, and the sound packs
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
