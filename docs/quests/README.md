# Spoken Quests pipeline

### [voiceline explorer: spoken.rusty.one/quests](https://spoken.rusty.one/quests)

## Overview

A pipeline for producing AI voiceovers for the quest and gossip dialogue of WoW: Forever, which
is mostly Classic's text. The corpus comes from the vmangos Classic world database. The sound
packs and the addon data modules are build outputs of this project.

Every line the project knows about is browsable, playable and — for signed-in collaborators —
re-voiceable at [spoken.rusty.one/quests](https://spoken.rusty.one/quests), which is the quests
section of `apps/web`; it is also the only place audio is made.

**Audio is made on the site and nowhere else.** Every take is cut there, archived as a file
of its own that is never changed, and recorded as a row; which take is live is a flag on
that row. This pipeline turns the world database into a corpus and turns the live takes
into a pack:

| Stage | Input | Output | Who runs it |
| --- | --- | --- | --- |
| `extract` | vmangos world DB | Postgres `quest_line` | a maintainer, when vmangos ships a new dump |
| `export-corpus` | Postgres `quest_line` | `corpus/corpus.json.gz` | before every build (`package-audio` runs it) |
| `make quests-sounds` | live takes + `audio-history/` | `audio/` | before every build |
| `build` | corpus + `audio/` | `dist/SpokenQuestsAudio/` | anyone cutting a release |
| `install` | the built module | WoW AddOns folder | to try it in game |

The corpus is **committed** — 17,507 lines, 2 MB gzipped — so building a pack from a given
`audio/` needs no dump and no Docker.

## Below is for developers only. Go to [releases](https://github.com/rusty-key/spoken-wow/releases) if you are looking to install the addon.

## Requirements

- Python 3.10+ — the pipeline
- Node 24 and pnpm — **only** to run the web explorer locally
- Docker — the vmangos MySQL when refreshing the corpus, and the explorer's Postgres

## Installation

1. Create and activate a virtual environment:
```bash
python -m venv .venv && source .venv/bin/activate
```
2. Install the everyday dependencies — five pure-Python packages, no compiled extensions
   and no database client:
```bash
pip install -r requirements.txt
```
   Add `-r requirements-dev.txt` to run the tests.
3. Copy the repo root's `.env.example` to `.env` and fill in your ElevenLabs API key:
```bash
cp ../../.env.example ../../.env
```
   That one file holds what this pipeline shares with the others — the ElevenLabs key, the
   vmangos `MYSQL_*` block, the CurseForge token. `pipelines/quests/.env` still exists for
   anything that is this pipeline's alone, and is read after it.

That's it. The committed corpus already contains every line's text, voice and metadata.

## Refreshing the corpus

Only needed when vmangos publishes a new database dump, or when the extraction needs a
column it didn't previously capture.

```bash
pip install -r requirements-extract.txt   # adds pandas, numpy, PyMySQL
docker compose up -d mysql                # the vmangos world DB
python cli-main.py init-db                # download and import the vmangos dump
DATABASE_URL=… python cli-main.py extract # into Postgres, as import-corpus would take it
make quests-export-corpus                 # then the committed file, from the database
```

Commit the re-exported corpus; the diff is reviewable. **The database is the corpus, and
`corpus/corpus.json.gz` is its export:** `export-corpus` is the only thing that writes it, and
the file says so in `producedBy`. Never edit it by hand or write it from an extract, a merge
or a script: change the database, then export. `import-corpus` is **dangerous** and for one use: seeding
an empty database, such as CI's or a new local one. It refuses a database that already holds
the corpus, because the file lags it and the import would put back the file's older text and
speakers; `--force` overrides that only to rebuild a database on purpose.

## Voice Setup

Generation resolves a voice by *name*, so your ElevenLabs account must hold voices named
`race-gender-flavor` — `orc-male-shady`, `nightelf-female-priestess`, `dwarf-male-grim`.
Stock library voices are ignored: their names cannot express that mapping.

**The flavor is which of a race and gender's several voices an NPC actually speaks with.**
Every playable race-gender has two or three distinct NPC voice sets recorded by different
actors — nightelf-male is standard, warrior and official; orc-female is standard, shaman and
warrior. The game chooses per NPC through its display info, and `tts_cli/flavors.py` recovers
that choice from the SoundEntries names, falling back to the race-gender's commonest set when
the game data does not answer. The corpus carries the result, so the current corpus needs 54
voices rather than one per race-gender. `narrator-male` is the exception and has no flavor:
it is a pseudo-race for gameobjects and items.

An NPC with no humanoid display - Shael'dryn, the OOX robots, Kum'isha - has no race or sex to
pick a voice by, so it is voiced by the model it is drawn with: `model-{ModelID}`, shared by
every NPC on that model. Its quest, gossip and follow-up lines are in the corpus, marked
`no-voice` until a voice is chosen for the model. Its quest and gossip rows come after the
follow-up rows, so every row before them keeps its place (`ord`). A patch variant of the same
NPC with a humanoid display wins.

The whole set is listed on `/voices`, which is also the easiest way to build it — see
"Managing voices". The clips to build them from sit in
`voice/seed-clips/<race-gender>/<flavor>/`, and a language other than English has its own
set under `voice/seed-clips/<lang>/`, the layout `/<lang>/voices` seeds from. That directory is gitignored and local-only.

## Usage

```bash
python cli-main.py --help
```

Selecting what to voice used to mean dragging a rectangle over a map image, which filtered
NPCs by world coordinates. That picker is gone — selection is now a filter over the corpus,
by NPC, quest, or spawn area. Spawn positions are carried in the corpus, so area selection
still works with no GUI and no database:

```python
from tts_cli.corpus import load_corpus, lines_in_area

corpus = load_corpus()
elwynn = lines_in_area(corpus, map_id=0, x_range=(-9900, -9000), y_range=(-600, 900))
```

### Producing a data module

```bash
make quests-sync                                      # production's corpus and take rows
make quests-pull-live                                 # the live takes those rows name, and no others
make quests-sounds                                    # audio/ from the live takes
python cli-main.py build                              # dist/SpokenQuestsAudio/
python cli-main.py install --force                    # into the AddOns folder
```

Sync first: `pull-live` reads its list from the local database, so a stale one fetches takes
production has already replaced. `make quests-full-release VERSION=x.y.z` runs sync, pull-live,
the pack build and, after one confirmation, the CurseForge and GitHub uploads.

`build` emits the sounds, every lookup table and a `sound_length_table.lua` computed from
the mp3s it just copied. The addon resolves sounds through that table rather than the
filesystem, so building the two together is what stops a line going silent.

For a module to hand to players, use `make quests-package-audio` instead: it transcodes first.

```bash
make quests-package-audio                # transcode to ogg, build the four packs, zip each, bundle them for GitHub -> dist/
make quests-package-meta                 # the "install everything" addon
make quests-package-audio PACKS=all      # every line in one folder, when trying an encode change
make quests-package-audio VERSION=1.4.0  # the version written into each pack's .toc
ENCODE=copy make quests-package-audio    # the masters untouched, to hear what is being given up
make quests-package                      # Spoken_Quests alone
```

Players of Blizzard's clients get Spoken_Quests inside `Spoken-<v>.zip`, which
`make package-spoken` builds (`scripts/spoken/package.sh`; its notes are in
`docs/spoken/CHANGELOG.md`). `make quests-package` builds the module alone. It takes its
version from `## Version:` in `Spoken_Quests.toc`. It refuses to build from an uncommitted tree
— `ALLOW_DIRTY=1` overrides while testing — and refuses when a variant `.toc` or
`Environment.lua` names a different version, which is drift nothing else notices until it ships.

**One zip for every client.** The clients pick a `.toc` by flavor suffix (`_Vanilla`, `_TBC`,
else the unsuffixed one, which Forever reads), so a single archive serves them all and the
client chooses.

The sound packs are the same files on every client. Their
`## Interface: 11509, 20506, 16001` names Era, Anniversary and Forever, as the places and
readables packs do. `DataModules` sets `checkAddonVersion` to 0 around
`LoadAddOn` so a client that considers a pack out of date loads it anyway. That switch reaches "out of date" and nothing else: the Forever client marks an
Interface it does not list as incompatible (since build 70170), which no setting overrides, so
every client a pack is filed against has to be on the line. Packs up to quests 2.2.0 carried
`100000` alone and relied on the switch.

**The shipping packs are Ogg Vorbis at 44.1 kHz** (`ogg-q0-44k`), which takes 3.2 GB of masters
to about 1.3 GB, split four ways. Vorbis is worth 1.3–1.5× over LAME at these rates and is VBR,
so the bits follow the voice instead of padding silence to a constant rate. A 22.05 kHz
downsample halves that again and speech survives the 11 kHz ceiling it imposes — it shipped as a
second set of packs for a while and is retired, because one format is one set of projects and one
answer to "which do I install".

There is no complete pack, every line in one folder: it is far over CurseForge's upload ceiling,
and the site no longer offers one. Its old address,
`/downloads/SpokenQuestsAudioComplete-latest.zip`, redirects to the meta addon's page, which
installs the four packs.

**The packs ship as five CurseForge projects** — four packs and a meta addon:

| | |
| --- | --- |
| Folders | `SpokenQuestsAudio…` |
| Titles | `Spoken Audio: Quests - Alliance` |
| Encode | `ogg-q0-44k`, ~300 MB a pack |
| Built by | `make quests-package-audio` + `quests-package-meta` |

The five projects the retired packs used stay published and are never uploaded to again, so
`MODULE` and `TITLE_FAMILY` in `scripts/quests/package-audio.sh` have one set of packs to name.
The folders were `VoiceOverReduxHQAudio…` until the rename. Renaming them is safe because
nothing stores a path built from a folder name — `DataModules` composes one at play time from
the folder the client reports — but `availableModules` in `DataModules.lua` has to move with
them, since that is how an installed pack is recognised.

[`docs/pack-size.md`](docs/pack-size.md) is where every encode was measured, along with the dead ends (deduplication, silence trimming, harder zip
compression — all worth nothing).

Homebrew's `ffmpeg` has no `libvorbis` and ffmpeg's own Vorbis encoder is worse, so `oggenc`
from `vorbis-tools` does the encoding and ffmpeg only decodes. Both are checked before a run
starts.

**A pack ships one format**, because `GetSoundPath` writes a single extension for every
sound: a module built from a half-transcoded store would resolve half its lines to files that
are not there, so `build` refuses a store holding two formats and the sound paths it writes
follow the store it was given. For an ogg pack every clip is therefore encoded. The 80 kbps
threshold in `tools/plan_transcode.py` only decides anything when the target is mp3 as well —
`-q:a 6` lands around 65 kbps on this speech, so a second pass over an already-64 kbps clip
would be no smaller and audibly worse.

Transcodes are cached in `audio-transcoded/<profile>/`, keyed on the **md5 of the master**, so
a re-generated line misses the cache and everything else is reused, and the two profiles never
read each other's entries. Keying on mtime would be wrong: `audio/` is assembled afresh from
the archive before every build, so an mtime says when, not what. The archived masters are
never touched — they stay 128 kbps mp3 — which is what makes raising the shipped quality
later a re-run rather than a second purchase.

Durations stay honest for free: `build` computes the length table from the files it just
copied, and mutagen reads a VBR mp3's Xing header and an Ogg page's granule position alike.

Word times come from the take table, which `build` never reads, so `scripts/audio/sounds.mjs`
writes the live takes' `wordTimes` into `audio/word-times.json` when it assembles the store, and
`package-audio.sh` stages that file with the clips. `build` writes `word_times_table.lua`
(`WordTimesByFileName`) for the clips the pack carries. A pack built without the file ships an
empty table, and its captions are estimated.

`install` moves any existing install aside to `<module>.replaced` rather than deleting it.

**Icons.** Every addon here carries an `icon.tga` and a `## IconTexture:` line naming
its own folder, which is what the client draws beside the name in the AddOns list; without it
each pack shows a red question mark. The sources are in `assets/icon/`, a 512 px PNG per mark:
`spoken-player-512.png` is the play triangle the player ships, `spoken-quests-512.png` the
exclamation mark Spoken Quests and all five sound packs ship. Each also comes as
`spoken-<mark>-<locale>-512.png` with the language's badge, which a language's packs and its
Spoken stub ship instead, so they are not mistaken for English's in the AddOns list. The `.tga`
beside each is committed rather than converted at build time so that building needs no ffmpeg
— `make quests-icon` regenerates them all from the PNGs, `tools/make_icon.py` is what it runs, and that
file's header explains why ffmpeg's own targa encoder is not used (it writes RLE, and the
client wants uncompressed).

The minimap button is the same mark again, as `addons/Spoken/Textures/MinimapButton.blp`
— BLP because a texture a frame loads is BLP on every client this ships to, where the AddOns
list takes either. `tools/make_minimap_icon.py` (also run by `make quests-icon`) crops the
shield's frame off the 512 px render before scaling, since LibDBIcon draws the icon 17 pixels
across inside a round border of its own and two frames at that size read as dirt; the header
explains the crop, the 5% LibDBIcon trims off each edge, and why the BLP is DXT5.

### The pack ships in four pieces

600 MB is more than CurseForge accepts in one upload — a 564 MB zip comes back `413` from
Cloudflare before CurseForge ever sees it — and more than a player wants for lines their
character cannot reach. So the store is transcoded once and built into four packs, with a meta
addon beside them:

| Pack | Folder | Zip |
| --- | --- | --- |
| All (meta addon) | `SpokenQuestsAudio` | 4 KB |
| Alliance quests | `SpokenQuestsAudioAlliance` | 161 MB |
| Horde quests | `SpokenQuestsAudioHorde` | 160 MB |
| Shared quests | `SpokenQuestsAudioShared` | 144 MB |
| Gossip | `SpokenQuestsAudioGossip` | 144 MB |

The four partition the audio exactly — 2,644 + 2,251 + 2,552 + 3,742 = 11,189 files, no overlap
and nothing dropped. A player installs their side plus Shared, adds Gossip if they want ambient
chatter, and lands around 300 MB instead of 600.

**All is a meta addon, not a pack.** One folder holding every line cannot be uploaded — 577 MB
is a Cloudflare `413` before CurseForge sees the body, which is what forced the split — so that
project ships a few kilobytes carrying no audio and declaring the other four as *required
dependencies*. The CurseForge app and WowUp fetch those automatically, so "install All" still
means "get everything", and no folder is ever owned by two projects. `scripts/quests/package-meta.sh`
builds it and its header explains the rest; `make quests-package-audio PACKS=all` still builds
the single complete folder for local use. For GitHub, which takes a larger file, the four
folders are bundled into one zip, `SpokenQuestsAudioAll-<version>.zip`; they are the folders
CurseForge installs, so the two channels overwrite each other. The stub deliberately carries no
`X-SpokenQuests-DataModule-Version` or the inherited `X-VoiceOver-DataModule-Version`: with either, the player would count the stub as an installed pack
and stop telling somebody with no audio where to get any.

**Each pack is an addon folder and a CurseForge project of its own**, never two files on one
project: addon managers install the newest file for a project, so a second file would silently
move a player from the pack they chose to whichever was uploaded last. The player needs no
change to read them — `DataModules:PrepareSound` walks every registered module and takes the
first whose `SoundLengthLookupByFileName` has the file, which is how upstream shipped a pack
per expansion. Every pack carries the full lookup tables (3.5 MB); they map text to ids and
hashes rather than to files, so an entry whose audio lives in a pack you did not install finds
no length and stays quiet.

**Which side a quest is on comes first from the Compendium's race masks**
(`addons/Spoken_Quests/Data/Compendium.lua`, `tts_cli/factions.py` `compendium_sides`): a quest
whose `races` are all one side's is that side's, and one open to both is shared. That covers
Forever's own quests, which the vmangos world DB lacks (528 more one-side quests than the export
below). A quest the Compendium does not list takes its side from `corpus/factions.json`, exported by
`make factions` from the world DB and committed beside the corpus, so building a pack never
needs a database. `tools/export_factions.py` explains the derivation, and the short version is
that `quest_template.RequiredRaces` is nearly useless — vanilla sets it on race and class
starting chains and little else — while the questgiver's faction template is decisive: a giver
hostile to Horde and not to Alliance is an Alliance questgiver. That classifies 1,419 Alliance
and 1,230 Horde quests and leaves the neutral hubs shared, which is the case a naive split
gets wrong. A quest with givers on both sides, or none, is shared: being generous costs a
player megabytes, being strict costs them a line that never plays.

### Releasing to CurseForge

```bash
make quests-release-dry                   # resolve clients, print every file and note, send nothing
make quests-release                       # upload every zip in dist/
./scripts/quests/release.sh audio-horde   # or just one target
```

`scripts/quests/release.sh` uploads what is **already in `dist/`** — it builds nothing, so the
zip that goes out is the one you tested. Six projects, one per target: `spoken`
([spoken](https://www.curseforge.com/wow/addons/spoken), `1700375`), which is
Spoken's zip; `audio-all`
([spoken-quests-audio-all](https://www.curseforge.com/wow/addons/spoken-quests-audio-all), `1660196`),
and `audio-alliance` / `audio-horde` / `audio-shared` / `audio-gossip`. `spoken-all`, the
English install-everything addon, is accepted by name and is never part of a bare run. A target
with no id fails the run rather than uploading a Horde pack over the Alliance project — which
is also why the five retired downsampled projects have no id here at all. It needs
`CURSEFORGE_TOKEN`, and `WAGO_TOKEN` for Wago, in the repo root's `.env`. The CurseForge one is
an *author* token from
[authors-old.curseforge.com](https://authors-old.curseforge.com/account/api-tokens), tied to
the account rather than a project, so one covers every project. A pack goes to CurseForge
alone: Wago answers `413` to a file that size, and `scripts/audio-github-release.sh` puts it on
GitHub.

The player and the packs are versioned independently, and each finds its version somewhere
different for a reason. The player is committed files with a `.toc`, so its version is read
there. A pack has no committed `.toc` at all — `build` generates one — so its version is read
back out of its module in `dist/`, which means releasing a pack nobody built fails instead of
uploading a stale zip that happens to still be lying around. `CHANGELOG.md` holds one section
per version and each target looks up its own.

Files are offered to **Forever (1.60.1), Era (1.15.9) and the 2.5.6 Anniversary client** only. Nothing
here has been run on any other client, and a file offered to a client it misbehaves on is worse
than one that is simply absent there. Client
names are resolved against `/api/game/versions` and a name matching anything but exactly one
version is fatal, because the alternative failure is a file filed against the wrong client —
which players meet as "the addon does not appear in my list".

Uploading a file cannot change the page around it: descriptions, relations and project
settings live in the web UI, and a script that rewrote them each release would be one that
could quietly undo an edit made there.

### A language's pack

A language other than English has one pack, holding both factions' quests and the gossip. It
exists because its page does: `publishers/quests/audio-<lang>.md` (`pack: all`) names the
project, version, folder and title that `scripts/lib/packs.mjs` reads instead of a case added to
a script per language. `LOCALE=` moves the chain — pull, assemble, build — to that language,
staged under `build/quests/<lang>/audio/` rather than English's `pipelines/quests/audio/`:

```bash
make quests-pull-live LOCALE=esMX          # this language's live takes
make quests-sounds LOCALE=esMX             # build/quests/esMX/audio, assembled from the archive
make quests-package-audio LOCALE=esMX      # SpokenQuestsAudio_esMX, encoded, into dist/
```

The zip goes to GitHub under the tag `quests-audio-<lang>/v<version>`
(`scripts/audio-github-release.sh quests esMX`).

The client never says which gossip line is on screen, only who is speaking and the words, and
the addon matches those words against a table to find the line's file. A client in another
locale shows them in its language, so a language's pack also carries that language's
gossip tables under `generated/<lang>/`, loaded only on a client in it (`tts_cli/locale_text.py`).
They are keyed on `quest_line.localeText` — the line as the world database, and so the client,
has it, not a correction made on the site — and `package-audio` exports it first
(`make export-locale-text LOCALE=esMX`, into `build/quests/esMX/`). Only the Gossip pack
carries them, once per language; English's packs are built as before. A language with no imported text (`make import-locale LOCALE=esMX`) still builds, with
a warning, and its gossip is matched against the English text.

#### A line for each player gender, where a language's text needs it

A language's own text decides whether a moment is one line or two. Where it branches on the
player's gender (`$G`, or `$U`) the moment is `:m` and `:f`, in files `m-…` and `f-…`;
otherwise it is one plain line, for every player, whatever English does. German can say one
thing where English says "lad" and "lass", and French can need two forms where English has one.
The import (`tts_cli/locale_import.py`), accept and the explorer's text editor all follow the
rule. A plain line made from a split English line is read beside English's male side.

A player's client has already picked one side of any `$G`, so a contribution is one plain line.
A moderator splits it by writing the `$G` back in the explorer: the plain line stops being
current and `:m` and `:f` take its place, both holding the template. Edited without a `$G`, a
side of a split moment changes alone; putting the plain version back undoes the split. English
splits the same way: a rewrite or an accepted correction holding a `$G` makes a plain line,
extracted or not, its `:m` and `:f`, each holding its own reader's words
(`apps/web/src/lib/quests/english-rewrite.ts`), and on a split moment it rewrites both sides. The site decides the shape: `extract` leaves out a dump
line the site split and gives its speakers to both sides (`split_here` in
`tts_cli/corpus_db.py`).

The forms of one moment are linked by its id without the suffix. Each takes the moment's
speakers, and the explorer shows a language its own lines, or English's while it has none. An
import that would reshape a moment retires the lines of the old shape, unless somebody edited
the moment here. The addon tries the player's `m-`/`f-` file before the plain one, so a pack
carries only the audio a current line names, or a voice of it (`scripts/audio/relevant.mjs`):
an old shape's takes stay live but would otherwise still play. A moment split or joined is
silent in that language until its new files are generated. Ignoring a line ignores every form
of its file.

A language's pack is built from its whole store, not from the English corpus, so a take of a
quest line only that language has (see "When there is no line at all") ships with the rest.
The addon finds a quest sound by its file name alone. A language split into faction packs would need
`tts_cli/factions.py` to place such lines, since the split reads the English corpus.

#### Italian, a language no client runs in

No Classic client ships `itIT`, so the world database has no Italian and no player's client
sends any. Its quest text comes from QuestIT (by Drakanast, MIT), a community
translation shipped as an addon, imported on each of its releases:

```bash
make quests-import-questit QUESTIT=~/Downloads/QuestIT ARGS=--dry-run   # match and count
make quests-import-questit QUESTIT=~/Downloads/QuestIT                  # write
```

QuestIT keys a translation by the hash of the English it was made from (its `Core.EnglishHash`),
which `tts_cli/questit.py` reproduces over the corpus's English. A line matches only if that
English is the corpus's, so a quest reworded since is left out. Rows are written with origin
`community` and the release in `note`; a later release replaces them, and a line edited on the
site keeps its edit. Everything client-keyed is skipped for a language like this (`client: false`
in `pipelines/lib/locales.mjs`): its pack carries no gossip locale text, the addon never picks
it on Auto, and it offers no contributions while a player listens in it.

#### Vietnamese, from Forever's mission export

`viVN` is the same kind of language, and its quest text comes from Forever's mission export, a
CSV with one row per paragraph of a quest's title, description, progress and completion text:

```bash
make quests-import-forever-csv CSV=~/Downloads/forever-mission-viVN-20261013-091803.csv ARGS=--dry-run
make quests-import-forever-csv CSV=~/Downloads/forever-mission-viVN-20261013-091803.csv
```

The export carries the English the Forever client showed beside each translation, and
`tts_cli/forever_csv.py` matches it by quest id and field against the corpus's English in that
shape (`<name>` for `$N`, `<boy/girl>` for `$G`, class and race names folded to tokens, the
items a progress text asks for cut off its end). A field whose English differs is left out,
which includes a line where Forever resolved `$G` to one gender: its translation would say
that gender to every reader. Objectives are not imported. Rows are `community`, with the
export's stamp in `note`.

### Browsing the corpus

Nothing in a filename identifies an NPC — quest audio is `{questID}-{accept|complete}.mp3`
and gossip audio is a content hash — so an NPC's lines are scattered across ~9,500 files
with no shared key. The web explorer reassembles that view. It is the `/quests` section of [spoken.rusty.one](https://spoken.rusty.one), beside the
zone lore one; to run it locally:

```bash
docker compose up -d postgres               # the app's own database
cd apps/web && cp .env.example .env.local && cd ../..
pnpm install
export DATABASE_URL=postgres://voiceover:voiceover@127.0.0.1:5432/voiceover
deploy/web/bin/migrate.sh "$PWD/apps/web"   # every migration, in order
make web-dev                                # http://localhost:3000
```

Apply migrations with that script rather than by hand: it is what the droplet and CI run, so
a migration that only works under an improvised `psql` fails here instead of mid-deploy. It
reads `DATABASE_URL` from the environment, which `.env.local` does not export.

Search by NPC name or id, or quest title or id, and play any line in the browser. Postgres
holds the corpus, accounts and roles, every take and which one is live, the pronunciation
lexicon, hand-written line overrides and the regeneration queue; the only thing on disk is
each take's audio, in `audio-history/`. A line with no live take shows as a gap.

**Progress text is hidden by default.** Those 3,093 lines — 17.7% of the corpus — are never
voiced by any code path, so leaving them in every result padded the list with rows nobody can
act on. **Show progress text** brings them back, and `?progress=1` says the same thing in a
URL; absence means hidden, so a bare link is the useful view. Ticking `progress` in the
source filter also counts as asking for them, since otherwise that choice would return
nothing. It is not counted as an active filter: it widens the results rather than narrowing
them, and clearing filters returns it to hidden.

**Gossip is a source, not an explorer of its own.** The source filter takes several values,
written `?source=accept,gossip`, so one view holds an NPC's greetings beside their quest text.
A gossip row has no quest, and its Quest / broadcast cell shows the BroadcastText ids it speaks
instead. `/gossip` redirects here with `source=gossip`, and `/contributions/gossip` to the
quests contributions with `stage=gossip`. `/reports/gossip` redirects to `/reports/quests`.

Lines with no audio are marked. `no audio` is a real gap; `progress` and `invalid-chars`
are lines the generator deliberately never voices.

A translation keeps Blizzard's `$N`, `$C` and `$R` in its stored text, and they are not what
makes it `invalid-chars`: `apps/web/src/lib/player-words.ts` speaks them as the language's
word for "adventurer" and "traveler" (`Abenteurer`, `aventurier`, `путник`, `冒险者`…) wherever
the line is judged or sent — the voiceability gate, the request, and the staleness and dirt
hashes, which go through one function (`sentText`) so they cannot disagree. Case follows the
position, not the token: lowercase mid-sentence, capitalised at a sentence's start and always
in German. A line's female variant, which exists where the English branches on `$G`, gets the
feminine word, and a leftover `$g…;` takes that variant's branch; `$u…;`, which ptBR's and
German's own templates write, is read the same way in every language. English quest text has
nothing left for it to replace, its words having been written in at extraction; a book page
in any language, English included, goes through the same table (`docs/readables/README.md`). A
token glued to a following letter (`$Nama`) is left in, so the line stays unvoiceable until a
translator rewrites it. German's genitive `s` is the one exception: `$Ns` and `$Cs` read as
`Abenteurers`, or `Abenteurerin` on the female variant. A branch never spans a sentence's end,
so one whose `;` was lost stays in as a token instead of swallowing the text up to a later `;`.
A Craftsman's Writ's `$2oa`, the item count the client fills in, reads as "an order of" in
English, "algumas unidades de" in ptBR, and "несколько" plus the second of ruRU's two written
forms (`порции:порций`); a language without words for it keeps the token and stays
unvoiceable.
Contributions triage shows any token still left after this, a bare `<` or `>`, and a gap
before `.` or `,` or a mid-sentence double space where a gender branch came through empty,
above the row's text, so a line that would never be voiced is seen before it is accepted.
Doing this at send time rather than in the rows covers every way a
translation arrives — the dump, the ptBR import, QuestIT's Italian, a player's contribution, a translator's edit
— and lets a word be changed later without rewriting any of them; the changed word then marks
those takes stale.

#### Accounts and roles

Registration at `/register` is open and needs no email confirmation. Everyone starts as a
**member**, which is the same read-only explorer an anonymous visitor gets.

| Role | Can |
|---|---|
| `member` | browse and play, like a signed-out visitor, plus whatever their language grants say |
| `admin` | everything in every language, plus `/admin` to change anyone's role and grants, `/voices` to manage voices and the global generation settings, and `/issues` to work through what the corpus scan found |

Everything between the two is granted one language at a time, English included, on the
same `/admin` page (“Users”): `edit` a language's text, `regenerate` its takes, `configure`
its lexicon, `ignore` lines in it, or `admin` there, which is all of those plus letting
others edit and regenerate in it. A language admin sees `/admin` too, narrowed to the
people working in their languages. What used to be the `collaborator` role is English
`edit` and `regenerate`; migration 0045 converted every holder.

**A grant is only half of it.** Everything that reaches ElevenLabs — regenerating, cloning a
voice, previewing a pronunciation, uploading the lexicon — is spent from the signed-in
user's own account, using a key they set on `/profile`. There is no server-wide key: the
site holds one sealed credential per person, AES-256-GCM under `SPOKEN_SECRET_KEY`, and a
route asked to spend without one answers `428 no_api_key` rather than reaching for
somebody else's plan. So "who paid for this line" always has an answer, and granting
`regenerate` does not quietly grant the deployer's bill along with it.

An admin can see which accounts hold a key on `/admin`, and clear one — the counterpart of
handing out `regenerate`. Neither they nor anyone else can read one back: what any surface ever
shows is the last four characters.

#### Regenerating audio

A line, a quest or a whole NPC can be re-voiced from the explorer. A single line is
regenerated directly — one click, one answer. Anything larger goes through a queue.

**A batch is rows in Postgres, not a loop in a tab.** Starting one posts the *filters* rather
than a job list, and the server re-derives the same line set the search ran, so a
forty-thousand-line batch is a small request. Closing the tab, reloading, losing the network
or deploying mid-batch changes nothing: the jobs are still there, and whichever process holds
the queue's Postgres advisory lock keeps draining them. That leader is one of the pm2 workers,
elected rather than configured, and a `pm2 reload` is a handover — the outgoing leader
finishes what is in flight before it lets go.

**It runs several at a time.** Concurrency comes from what the ElevenLabs plan allows for the
model in force, minus one slot held back so the single-line button and the `/lexicon` previews
are never starved by a running batch. A rate limit halves the budget for a minute rather than
retrying into a wall; a rate-limited job backs off with jitter and is retried three times
before it fails. A *fatal* error — quota, a bad key, a missing voice — fails the job and
cancels the rest of the batch in the same statement, because those fail every remaining line
identically.

**The panel is global.** It shows counts by state, the real summed credits, the failures and
whatever another admin started, since the budget being spent is the same account's. **Stop**
cancels everything pending and lets the in-flight requests finish: those characters are billed
already, so throwing away the audio would pay for nothing.

**Nothing is generated twice.** A partial unique index on the file rejects a job for an mp3
already pending or running, and the panel reports how many it skipped rather than hiding them.

**Regeneration replaces a file, not a line.** 1,076 files are spoken by more than one NPC —
a gossip file is named `md5(text + race + gender)` — so every NPC sharing a line hears the
change, and a batch generates each file once however many lines point at it.

**Every take is kept.** Before the first regeneration overwrites a file, whatever was there
is archived as version 0, and the history popover on the line plays and restores any take.
Version 0 is never pruned: it is audio that predates this project's ability to reproduce it,
and losing that is exactly how the project ended up with voices it could not remake. The
newest four are kept alongside it.

**What it costs.** ElevenLabs does not bill the characters you send; it bills
`characters × rate`, where the rate belongs to your plan — 0.55 on a Creator account, half
that for the flash and turbo models. So the confirm dialog before a batch estimates from
what your account has actually been charged, and every response reports its exact cost, which
the panel sums as it runs. Until there is anything to calibrate from it shows the list rate
as an upper bound and says so.

Settings — model, stability, similarity, style, seed strategy — are global and live on
`/voices`, admin-only. They override `voice/generation.json`, which stays what the Python CLI
reads, so the two can drift; the page shows which is in force.

#### Pronunciation

`/lexicon` is admin-only, and holds the names a text-to-speech reader gets wrong — Gnomeregan
with its silent G, Kel'Thuzad, Cairne, and the 131 others it starts with. Saving
uploads them to ElevenLabs as a pronunciation dictionary and pins every later request to that
exact version.

Every entry is one row, edited in place: the pencil turns its cells into fields of the same
width, and the checkbox in the OK column records that somebody has listened. The All / OK /
Not OK filter is how you find the ones still to be checked.

**You do not need IPA.** An entry gives either an IPA pronunciation or a plain respelling —
`nomeregan` — and the `ʒ` button switches between the two in one click; the slashes around an
IPA field are drawn by the editor, and never part of the value. The trade is exactness
against reach: IPA becomes a phoneme rule, which is precise but honoured only by `eleven_v3`
and `eleven_flash_v2`; a respelling becomes an alias rule, which is only as good as the guess
at the new spelling but works on every model. Both kinds sit in one dictionary, so the lexicon
does not have to pick. When the configured model ignores phoneme rules the page says how many
entries that silently skips, rather than implying the whole page is inert.

Respell it as it should be *said*. Stress capitals steer the model, so `NOME-reh-gan` is a
valid respelling.

**A phoneme rule cannot be case-insensitive.** ElevenLabs discards one carrying
`case_sensitive: false` *silently* — a 200, an id, a version, and the rule simply absent from
the stored dictionary. Alias rules tolerate the same flag, which is what made this so hard to
see. So phoneme rules go up with `case_sensitive: true` — **one rule per spelling, derived, not
typed**. You add `Forsaken` once and the upload carries `Forsaken`, `forsaken` and `FORSAKEN`,
because those are what the corpus contains. 134 entries become 156 rules. Aliases keep
`case_sensitive: false`, where it works, and need no expansion.

Spellings come from two places. Whatever the corpus actually uses is scanned for; and a
lower-case entry additionally gets its capitalised form whether or not one occurs yet, because
`satyr` beginning a sentence is a fact about English rather than about this corpus.

**Every request pins the language to English.** ElevenLabs infers language from the text
otherwise, and a short input gives it almost nothing to go on — a bare name in a word preview
gives it nothing at all, which is how one comes back with the wrong language's vowels.
`language_code` also governs text normalization, so it plausibly decides how a phoneme string
is read. Sent only to models documented as accepting it; omitting is what every request did
before, so a model absent from that list loses nothing.

**Every upload is read back and counted.** Send N rules, download the dictionary, count the
lexemes. A mismatch is shown on the page rather than trusted away — the absence of this check
is why a lexicon that had never applied a single pronunciation reported itself healthy for
weeks.

**Saving does not touch audio already in the store.** Each take records the dictionary version
and a hash of the text it was spoken with, so a line generated before a fix stays playable and
stays identifiable as out of date.

**The lexicon lives in the database, not in the repo.** Unlike the generation settings there
is no file layer at all: migration `0008` carries the 134 starting entries and seeds the
`pronunciation_lexicon` row once, and every change after that is made in the editor. A copy on
disk could only be a stale snapshot competing with the live data — and "reset to the committed
lexicon" would have meant discarding real work to return to whatever that copy said at deploy
time.

The Python CLI sends no dictionary at all — it is the one place the two generators no longer
produce identical audio.

**One dictionary, one id, updated in place.** `ELEVENLABS_DICTIONARY_ID` names it, and a save
brings its rules to whatever the lexicon now holds rather than creating a new dictionary. The
id has to be stable because it is shared: `../wow-lore` narrates a different corpus on the
same ElevenLabs account, gets the same names wrong, and simply writes this id into its
`tools/voice/config.json`. Nothing else crosses between the two projects — no database, no
API, no exported file — and this one is the only place the lexicon is edited.

A save sends *every* rule the lexicon holds and then removes only the strings it no longer
has. `add-rules` replaces a rule matching the same string, so the upload needs no diff, and
adding before removing means there is no instant at which a name still in the lexicon has no
pronunciation. This is why the earlier design — a fresh dictionary per save, to avoid a diff
whose failure mode is an invisible leftover rule — is no longer worth its cost. Versions stay
immutable and every request still pins one, so generation already in flight is untouched.

With the id unset the old behaviour returns: a dictionary is created, and its id is logged as
the value to configure.

#### What the corpus scan found

`tools/scan_corpus_hiccups.py` reads the corpus and lists every token or fragment likely to
trip a reader up — invented names no pronunciation rule covers, stage directions in asterisks,
Blizzard's own typos, raw binary, alphanumeric codes. It is retired as it stands: the
`/issues` queue its JSON fed is gone, so the JSON is written only with `--json` and is no
longer committed or shipped. `docs/corpus-hiccups.md` documents the method and the categories.

**A finding is a detection, not a defect.** `Ashenvale` occurring 199 times is a fact about
the corpus; whether it is a problem depends on the lexicon and on someone having listened. So
the scan does not consult the lexicon — coverage is decided when the findings are loaded, and
a reload replaces every detection while leaving every verdict (`open`, `fixed`,
`dismissed`) alone.

**Some lines cannot be fixed by pronunciation.** `q:1155:accept` is the single letter `x`;
`q:257:complete` says "adventurerama", because Blizzard wrote `$Nama` and the token
substitutes to a fixed word. For those a collaborator rewrites what the line *says*, and the
explorer marks it **rewritten**. An override changes the spoken text only: the filename and
every addon lookup key derive from the original text, so a rewrite can never rename a file or
make the addon miss it. It also reopens the `invalid-chars` gate — stripping a `$` or a `<>`
makes an otherwise unvoiceable line voiceable — while `progress` lines stay skipped, because
that is policy rather than a text defect. The one token a rewrite may hold is a
`$gmale:female;` branch, which splits the line by player gender instead of overriding it.

**Audio made before a fix says so.** Every take records a hash of the exact string sent to
ElevenLabs, so a line whose text has since changed — by a rewrite, a pronunciation rule or a
corpus refresh — is marked **text changed** and stays playable until someone regenerates it.
Takes from before that hash existed are reported as fresh rather than guessed at.

Like the lexicon, overrides live only in the database, and the Python CLI does not see them.

#### Managing voices

`/voices` is admin-only. It lists every voice on the roster — alphabetically, so a
race-gender's flavors sit together — with the lines and NPCs each one carries, and marks which
exist in the ElevenLabs account. The roster is in the database (migration 0071): every type an
NPC can be, its genders and flavors, and the voice each combination is read by, edited by an
admin on the Types tab of `/npcs` and read by the triage selects and the explorer filters too.
A voice there has a slot before any line uses it, so it can be cloned before its first line is
accepted. The corpus only supplies the counts; a test fails on
a corpus line whose voice is not on the roster, and accepting a contribution refuses one. The
Skybourne elves have the game's two voice sets per gender, named by their NPCSounds id
(`skybourneelf-male-3776`) until they have better names.

Expanding one shows the clips it would be cloned from: upload, play back, delete, and
**merge** a selection into one take with an adjustable pause. A slot finds its own source
material in `voice/seed-clips/<race-gender>/<flavor>/`, which is the shape of its name — no
mapping table to keep in sync when a flavor is added. A slot with no flavor seeds from the files
directly in `<race-gender>/`, as `bloodelf-female` does: the one voice the roster gives
them. `narrator-male` has nothing to seed from, which is expected: it is a voice, not a type.
It reads the `gameobject`, `item` and `creature` types, which is how a quest started from a
billboard says it was a gameobject and is still read by the narrator.

Merging is there because the practical source is one-second greeting clips.
ElevenLabs treats combined length as what decides clone quality — one to two minutes is the
target, past three it grows unstable — and a pile of one-second files gives the model no
continuity between them. It defaults to deleting the originals, because cloning uploads every
clip in the folder and keeping both would send the same audio twice.

**Create voice** spends one of the account's custom voice slots (30 on Creator, fewer than
the 54 the corpus asks for, so a Creator account cannot hold the full roster at once).
**Replace**
is delete-then-add: ElevenLabs has no re-train call, and two voices sharing a name would make
`fetch_voice_map` ambiguous. The clips stay on disk either way — an ElevenLabs voice cannot
be exported, so they are the only way to remake one. Losing that is precisely why this project
inherited voices it could not reproduce, so `make pull-voices` them somewhere safe.

Merging needs `ffmpeg` on the server. Uploading and cloning do not.

There is no way to create the first admin through the UI, by design. Promote yourself once,
directly against the database, and hand out every later role from `/admin`:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'you@example.com';
```

#### Deploying the explorer

The explorer runs at [spoken.rusty.one/quests](https://spoken.rusty.one/quests), on a
DigitalOcean droplet behind nginx. The old voiceover.rusty.one addresses redirect there
(`deploy/web/nginx-voiceover-redirect.conf`). Pushing to `master` builds and ships it automatically — the workflow
typechecks, applies the migrations with the droplet's own script, runs the tests against a
throwaway Postgres, and only then builds and swaps the release. The audio does not travel
with it: takes are cut on the droplet, and come home one way, by hand.

```bash
make quests-pull-history     # every take; some are unreproducible, so back this up
make quests-history-status   # take count and size on both sides
make quests-export-ignores   # the ignore list, database -> corpus/ignored.json (commit it)
make web-releases            # what is deployed, and what you can roll back to
make web-rollback            # back one release; RELEASE=<name> to pick one
```

Deploys are versioned as directories under `/srv/spoken/releases/`, with `current` a
symlink that pm2 follows, so a rollback is a symlink swap needing neither CI nor network.
The take archive lives outside every release in `shared/`: it is never copied on deploy and
survives a rollback untouched. Migrations run before the swap and are forward-only — a
rollback restores code, never schema, so every release must run against the schema of the
release after it.

A running batch survives a deploy. The new leader picks up whatever it finds in the queue,
and the outgoing one is given 30 seconds to finish its in-flight generations before pm2 kills
it, which is what `kill_timeout` in `deploy/web/ecosystem.config.js` is for.

First-time droplet setup, the nginx vhost, and the GitHub secrets the workflow needs are in
[`deploy/web/README.md`](../../deploy/web/README.md).

## Output

`make quests-sounds` fills `audio/{quests,gossip}/` from the live takes in `audio-history/`,
and is run again before every build rather than kept. `build` copies from there into
`dist/SpokenQuestsAudio/generated/sounds/`, alongside every lookup table and the
`sound_length_table.lua` computed from exactly those files. A pack for players goes through
`make quests-package-audio`, which runs `quests-sounds` and stages an ogg copy first — see
*Packaging*.

### Stage directions and the narrator

Blizzard writes stage directions inside the NPC's own quest text — `<Advisor Belgrum opens the
note and begins to read.>` — and having the dwarf read that aloud in character is worse than
silence. The web app hands those to a separate voice, `narrator-male`, and ElevenLabs returns
the NPC's speech and the narration as a single file through its text-to-dialogue endpoint.

The same brackets also hold sounds the NPC makes: `<hic>`, `<cough>`, `<sigh>`, `<mutters>`.
**Capitalisation is what tells them apart**, and it separates all 90 bracketed spans in the
corpus with no exceptions — a direction names someone, a sound is a bare lowercase word. Do not
also require a closing full stop; that misclassifies `Motega shrugs his shoulder`. A sound is
not narrated: `audioTags` rewrites it into ElevenLabs' own syntax — `<hic>` becomes `[hic]` —
and the NPC performs it in their own voice, which `eleven_v3` (the default everywhere)
understands and `eleven_multilingual_v2` does not. The rewrite runs on the whole line before it
is split, so a line whose only bracket is a sound never touches the dialogue endpoint.

Because voiceability is recomputed from the effective text rather than read from the corpus,
this unblocked 62 previously silent lines without regenerating the corpus. **Nothing is
generated in bulk.** Tick **has narration** in the explorer to find these lines, listen, and
regenerate the ones worth fixing through the usual controls.

### Handing a stretch to another voice

Some lines are spoken by somebody other than their giver, and nothing in Blizzard's text says
so. Wizbang's Buzzbox quests are given by an object, so the line is correctly `narrator-male`,
yet most of it is Wizbang talking through the machine. A rewrite can say it with a **voice
marker**: a slot name between underscores, which hands the rest of the line, up to the next
marker, to that slot.

```
A tiny voice crackles from deep within the machine.

_goblin-male-zany_
"Wizbang here! The next Buzzbox is north of Auberdine, on the beach..."
```

The marker must be a whole slot name as `/voices` lists it (`race-gender-flavor`, or
`narrator-male`) and must stand alone, not inside a word. Stage directions inside a marked
stretch are still the narrator's, a marked stretch takes its own race's accent direction, and
a slot the account has no voice for is refused before anything is spent. The line then goes
through the dialogue endpoint like a narrated one.

### Lines nobody will ever voice

Some lines are not worth audio and never will be. The war-effort tallies read `$2113w` — a
world-state counter the game expands against a live server, so no committed corpus can hold
the number and no take of the line can be right. Quest 1 is a Blizzard test quest called
`The "Chow" Quest (123)aa`. Neither is a text defect an override could fix.

**Ignoring is per line and carries a reason.** An admin ticks it on the row; the decision goes
to `line_ignore` in Postgres, keyed on the corpus's `lineId` — not the file, because 1,076
mp3s are addressed by more than one line, and a dead line can share a file with a live one.
An ignored line disappears from searches unless **ignored only** is ticked, is refused by
regeneration before a request is spent, and is left out of the addon's lookup tables so no
entry resolves to a sound that will never exist.

The pack build reads no database, so the list is exported:

```bash
make quests-export-ignores    # database -> corpus/ignored.json; commit it
```

That file is what `tts_cli/ignores.py` reads. `build` leaves both the audio and the lookup
entries out of the module; the takes themselves stay in the archive. **A file is only excluded when every line addressing it is ignored**, so ignoring one
gendered variant of a shared gossip line strands nothing.

Seeded with the 35 war-effort lines and quest 1 by migration `0017`.

#### Quests no player can reach

The extraction applies no patch filter, so the corpus is a superset of the game: vmangos gates
every table it loads a quest through on the patch the server runs, and the dump holds content
1.12 never serves. Two ways to find that out, deliberately independent:

```bash
python3 tools/scan_unreachable_quests.py            # the vmangos world DB, needs MySQL up
python3 tools/scan_unreachable_quests.py --gossip   # and the NPCs whose gossip nobody hears
```

It asks the three questions the core asks — is there a `quest_template` row at this patch, is
there a questgiver relation in range, does any of those questgivers spawn — and prints the
corpus lines hanging off each quest that fails one. Nine findings today, three of them certain.

`--gossip` asks the speaker instead of the quest, since gossip belongs to whoever is standing
there: 47 NPCs and 88 lines, every one of them `likely` rather than certain. Read that section
sceptically — it is Finkle Einhorn, who appears out of the Beast's corpse, the Darrowshire
spirits, the AV commanders and the Felwood cleansed plants. Script-spawned entities are in no
spawn table, and this cannot tell them from content that is genuinely gone.
The rules are in `tts_cli/reachability.py` and tested against fixtures, so they can be read
without standing the database up.

`docs/unreachable-quest-candidates.md` is the second source: Questie's hand-curated blacklist,
filtered to the entries that actually claim a quest is missing rather than merely hidden from
its map.

**Both are reports, and neither acts.** A `no-spawn` finding is a lead, not a verdict — the
Alterac Valley questgivers are spawned by the battleground's scripts and appear in no table, so
the scan flags quests a player really can do. Read the quest, then ignore it in the explorer
where the decision carries a reason.

The Compendium reads the same list. `tts_cli/quest_text.py` `left_out` is the one rule for which
quests it lists and has words for: Blizzard's debris (quest 1, `<NYI>` titles), a quest every
line of which is ignored, and the `remove` entries of `corpus/compendium_overrides.json`. The
packs follow the same rule: `build` treats every offer, progress and hand-in line of a quest left
out as ignored (`ignores.pack_ignored`), so its audio and its quest-log giver leave the pack with
its page. Follow-up lines, said in chat, are not touched.

### Reporting a line

Two routes, one destination. In the explorer, every row has a flag button that opens the report
form in a dialog — no navigation, and the row already knows which line it is, so the report
carries a `lineId` as well as an address. From the game, a Report button gives the
player an address to open, which lands on `/quests/r/…` and shows the same form.

Both write the same `target` string (`lib/reports/line-target.ts` composes it from a corpus
line, mirroring `formatTarget`), so triage reads one list rather than two. The button is
outside the collaborator gate on purpose: `POST /api/reports` is unauthenticated by design,
because reporting is what a player who cannot sign in has.

### Reports from inside the game

Report is a round bug icon, and it sits where the line is: in the corner of Spoken's windows,
beside the subtitles' hover controls, in Spoken Quests' row of controls on DialogueUI's window,
beside Play on the details view of the Forever quest log, and on each part of a quest's page in
Azeroth's Compendium. It shows whether or not audio actually played — a silent quest is among
the most useful things a player can tell you — and for gossip and greetings as well as quests.
Spoken's **Hide Report Buttons** takes it away. The **Fix a Problem** section of Spoken's page
has a Report a Problem button too, for what belongs to no one line. Clicking an icon opens a
copy box holding an address, because the client cannot open a URL or send anything anywhere;
the player copies it and opens it in a browser.

The address is built from what the client can see, never from what the data module resolved
(`ReportButton:TargetForQuest` and `TargetForGUID`, through `Spoken:ReportURL`):
`https://spoken.rusty.one/quests/r/quest/{questID}/{accept|progress|complete}`, or
`…/quests/r/npc/{creatureID}` for gossip, for a client reporting quest id `0`, and as the
fallback whenever a quest id is unavailable. A gameobject has `…/quests/r/object/{objectID}`,
since creature and object ids overlap (creature 68 is a guard, object 68 a poster). A line
that was read in a language other than English adds it: `https://spoken.rusty.one/{lang}/quests/r/…`.
That matters because a data module which failed to load produces no `soundData` at all, and
that is exactly the state most worth hearing about. It also means there is no slug or hash
shared between Lua and Python that could silently drift. `tests/lua/report_url_contract_test.lua`
holds every address the modules build to `tests/fixtures/report-urls.txt`, which
`apps/web/src/lib/reports/report-urls.test.ts` opens through the site's routes. Installed copies
that still build `voiceover.rusty.one/r/…` are redirected.

The landing page resolves the address against the corpus, plays the take that is currently
live, and hosts the form. An address that resolves to nothing still renders the form — an
addon sending players to a page the corpus does not know about is itself a bug report.

`POST /api/reports` is the only unauthenticated write in the explorer. It is defended by a
honeypot field answered with `200` rather than `400` (an error only teaches a script to stop
sending the field), a limit of ten reports per hour per IP counted in Postgres so it survives a
pm2 restart, and a category checked against a closed set. The IP is the rate limiter's key and
nothing else: never displayed, never read back. Signing in replaces any typed name.

Collaborators and admins triage at `/reports`, marking each report fixed, not a problem or
minor, or reopening it. Minor (migration 0079) sets a report aside: real, but not worth
attention now. It is not open, so no count, badge or sorting queue shows it; it waits under
its own tab until someone resolves or reopens it. **A report never becomes a regeneration job.** Regenerating spends ElevenLabs
credits, so nothing public can start one; someone reads the report, listens, and queues the
file through the normal flow.

`/reports/sort` is the same triage one line at a time, laid out for a phone. It offers quests
(gossip included), readables and places with how many lines each has open, then walks one section's
lines, most reported first, each with its line, its takes, its reports, the explorers' player
and Play, Edit and Regenerate.
Fixed, Not a problem and Minor answer every open report on the line. Skip is per person and stored in
`report_skip` (migration 0074), per report: a line comes back when a new report arrives on it,
and Reset on the picker brings back everything that person skipped in that section.

### When there is no line at all

A report presumes a line exists and is wrong. Some of the time there is no line to be wrong —
the corpus is built from a 1.12 world database, so it has nothing for content that postdates
vanilla, for a locale that database does not carry, or for custom content a server added on
top of it. In those three cases the client in front of the player is holding the only copy of
the text, and `Contribute:HasGap()` puts a button reading **"Contribute"** — the same word
the Readables button carries — in the strip under the close button at the top right of the
Blizzard quest or gossip window, exactly when there is text on screen and nothing queued to
play. The quest log offers the same thing where a quest's Play would be: a small plus icon
in the list, and the details view's Play reading **Contribute**. A contribution from the log
carries the quest's own description as its accept text and `from=log`, but no NPC — the log
does not say who gave the quest. A player who does not want it turns it off with **Hide Contribute Buttons** in the Contribute
section of Spoken's settings, one switch for the buttons of every module; each module
asks `Spoken:AreContributeButtonsHidden()` in its gap check and refreshes on the player's
`CONTRIBUTE_SETTINGS_CHANGED` callback, since toggling it fires no game event.
With DialogueUI, which never shows the game's quest and gossip frames, the Report icon goes
in Spoken Quests' row of controls on the window's title line instead, right of Play and Skip
and left of a close button, the window's text moved down to make room. It reports on every
page and contributes where a line is missing. The words in that window are marked as they are
read through `Spoken:WordMarks()`, the captions' matching kept in Spoken (see
[`DIALOGUEUI-BRIDGE.md`](DIALOGUEUI-BRIDGE.md)).
**Hide Report Buttons**, in Spoken's settings, takes the icon away with every other Report button,
the quest log's included, except where it contributes; each addon asks
`Spoken:AreReportButtonsHidden()` and redraws on the player's `REPORT_SETTINGS_CHANGED` callback.

Clicking it opens Spoken's contribute box (`UI/ContributeBox.lua`). It holds a link to
`spoken.rusty.one/contribute` that carries an envelope: the addon, the build, the locale, the
quest or NPC (never a player: a quest a party member shares names no one and carries no
observations of them), and the text itself. Where no link can be built it holds the envelope and the
address to paste. The client still cannot open a browser or post anywhere, so the player copies
it, opens it, sees a field-by-field preview of exactly what is about to be sent, and submits.
The first click ever asks whether to send just that line or to collect as the player plays:
**Collect Missing Lines** (`Gather.lua`, `/sp collect`) keeps every line Spoken is missing in
`SpokenContributions.lua`, which the player uploads at `/contribute` (`/sp send` says how). It
also keeps a line that plays but whose words on screen are not the ones its text has, tokens,
case and spacing aside (`DataModules:IsTextKnown`), so the site can correct it: gossip against
the speaker's lines in the client's language, a quest moment against its wordings, or for one
wording against the Compendium's English accept and complete text. Progress text, and a quest
moment of one wording in another language, have nothing to compare with and are not checked.

The same text pasted again — by the same player or a different one — bumps a count on the
existing row rather than filing a second one; different text under the same key stays its own
row. That count is the triage priority at `/contributions`, the contribution queue's own
`/reports`: a collaborator accepts or rejects, and **accepting never starts generation** — a
contribution becomes corpus text and a regeneration job the same deliberate way a report
becomes a fix, by a person reading it first.

Accepting a quest row writes it into the quest tables, the same ones the extract fills
(`lib/contributions/accept.ts`): a `quest_line` with origin `contributed`, named by the same
rules `tts_cli/naming.py` uses, and a `quest_line_speaker` row carrying the contribution's id.
From there it is an ordinary line — the explorer lists it under missing audio with a
*contributed* badge linking back, an editor fixes anything the player's client substituted
that the addon could not put back (the branch of a `$G` it picked) through the usual text
override, generates a take, and the next export carries it into the pack. The addon does put
back the reader's own name, class and race as `$N`, `$C` and `$R` before sending — only the
client knows which words those were; the name as written and in capitals — so a contributed line is a template like an extracted
one: stored as `originalText`, spoken as `Adventurer`/`Traveler` by the extract's own table,
and hashed on the template when it is gossip. Class and race are swapped wherever they occur as
whole words, so a warrior's "a warrior's discipline" arrives as "a `$c`'s discipline"; that
false positive is accepted over voicing one player's class at everyone, except on a quest only
that class can take (the Compendium's `classes` is that one class), where the class is left as
written. The contribution's id on its speaker row, or its note on the first
version of a line it wrote without one, is the mark, not the line's origin, because an edit
puts an `edited` version on top. A contributed speaker is what `corpus_db.py`'s import leaves
alone when it replaces every extracted speaker, and it numbers from 1,000,000 so a re-import
never meets it. The corpus
wins where it already has the line: a quest moment is matched by quest id and moment alone
(the tables carry some only as `:m`/`:f` variants), and a quest moment or gossip line it already
has gains the contributing NPC as one more speaker instead of a copy. Progress lines are kept, marked
`progress` and never voiced, as the extract marks its own. Once written, a contribution cannot
be moved back to new. Rejecting it ignores every line it wrote, reason `Rejected contribution
#N`: in its language, or in every language for an English row, so it needs the same right an
ignore does (`ignore` in the language; for English, whoever configures generation). A line it
only added a speaker to is ignored whole. Rows, takes and audio stay, so lifting the ignore in
the explorer brings the line back.

A quest row is accepted the same way whatever language its client was in. A line is the
language's own `quest_line` row; who speaks it is a fact about the world, so a speaker row any
language wrote voices the line in every language. Accepting a quest moment writes the
language's row, and a `quest_line_speaker` row when the moment has no speaker in any language
yet or its speakers do not include the contribution's NPC: a quest two givers offer is voiced in
each one's voice. Only then does it need the NPC's race and gender answered, and the
contributions page counts such a row as blocked until it has them. A speaker added to a moment
someone already speaks goes on each of its lines, in the language its speakers are in. Its id
and file are the quest's and the moment's, the same in every language, so nothing has to be
sent in English first, and English sending the moment later writes English's row under the
same id and file, voiced by the speaker already there. In another language the line keeps its
`$N`, `$C` and `$R`, as a translation's does.

The catalogues read speakers the same way (`catalogue.ts`'s `SPEAKERS`, and `export_corpus`):
a line's English speakers where it has any, otherwise those a language wrote, each NPC once.
A language's explorer lists its own rows, plus English's lines it has no text for, marked
untranslated; English is joined only to show what a line says in English. Who speaks is
answered by a moderator with `regenerate` in the contribution's language. The answer is about
the NPC (`npc`), so it holds for every language.

A gossip row, in any language, is matched in three steps (`apps/web/src/lib/contributions/gossip.ts`):

1. **By its words:** a line the language already has with the same text, case and spacing
   aside, spoken by the same race and gender. English asks the catalogue, as it always has; another
   language asks its own rows' `localeText`.
2. **By BroadcastText:** the lowest id whose text in the language reads the same, in the form the
   NPC's sex shows (`text` for male, `text1` for female, either side of a `$g` or `$u` branch, or
   the `$u` unresolved, as the client sends it), then a line of that id (`gossip_broadcast`)
   in the same race and gender. A line named after its id must also have the same flavor.
3. **Otherwise a new line:** `g:b{id}-{voice}` when the id is known, else `g:{md5}` in English
   and `g:{lang}-{md5}` in another language.

What a match writes depends on what the line has. If it already has a row in the language,
the NPC becomes one more speaker, unless it already is one. If it only has English, the
language gets a translation of it. If it has no English, an English row makes it an English
line under the same id, and another language's row is written as that language's own. The id
a line was found or made by is recorded in `gossip_broadcast` as `text`.

#### Who is speaking

A line still needs a voice, and a voice name is `race-gender-flavor`. The corpus answers that
for every NPC it carries. For one it has never seen, the answer has to come from somewhere, and
the client can supply two thirds of it.

The addon reports what it can see and nothing more: `kind` (creature, gameobject or item: an
item's GUID holds no item id, so the id is the bag item whose quest is on screen), `model` —
the model file id a `PlayerModel` frame answers for the unit — `sex` from `UnitSex`, and
`creature` from `UnitCreatureType`. It carries no race table. `apps/web/src/lib/npc/models.ts`
holds that instead, 81 character models across 32 races, and maps `122055` to
`{race: "tauren", gender: "male"}`. The path a race and gender resolve to on disk —
`character/tauren/male/taurenmale.m2` — lives in the community listfile, not in this repo; the
model table only ever needs the race and the gender an id names, never the path itself. The
table lives on the site deliberately: a race added upstream, or an id that turns out to mean
something else, is corrected in one deploy, while a table shipped inside the addon waits for
every player to take an update.

`resolveNpc` then answers in order, stopping at the first that knows:

1. **A moderator's answer.** Somebody looked, and they may know something no data source does.
2. **The corpus**, for an NPC it already carries. Exact, and the only one of the three that
   supplies a real flavor.
3. **The client's model id**, mapped to a race and a gender, with the flavor defaulted and the
   row left **unconfirmed**. The default is not a constant: `lib/corpus.ts:defaultFlavorFor`
   mirrors `tts_cli/flavors.py`'s own `fallback_flavors` — "standard" where that race-gender has
   it, otherwise its busiest flavor, from the corpus rather than a hardcoded name. Four
   race-genders (dwarf-female, goblin-female, goblin-male, tauren-male) have no standard voice
   in the game at all, so a constant would leave them pointing at nothing; tauren-male defaults
   to `warrior`, its busiest, not `standard`. A race-gender the corpus has never carried a
   flavored line for at all defaults to no flavor rather than a guess.
4. **Nothing.** A murloc, a dragon or an elemental is drawn with a creature model rather than a
   character one, and resolves to no race at all. That is a normal outcome, not a failure:
   `narrator-male` has always been the pseudo-race for things that do not have one.

**The flavor is read from the creature's appearances, not from the unit on screen.**
`tts_cli/flavors.py` recovers it for the corpus from SoundEntries names like
`DwarfFemaleMaternalNPCGreetings`. In game, no API exposes a creature's `NPCSoundID` or which
appearance a unit is drawn with: `GetDisplayInfo()` on a model built with `SetUnit` answers 0.
`SetCreature(npcId)` does answer, but it rolls one of the creature's appearances (at most
four) by spawn probability, fresh on every call. So the addon rolls 32 times on one hidden
frame and sends every appearance it saw as `displays=`. `voiceFromDisplays` keeps the ones
drawn with the body the client reported and maps them through `display-voices.json`. One voice
left, for a creature whose model the site knows, is written as `display`, confirmed. Several
voices on one body, as with a dwarf woman who can be maternal, young or guard, leave the row
`client`, with the flavor chosen among those voices; so do appearances with no known model to
vouch for them, since the envelope is unauthenticated.

Two things a `display` row can still get wrong, both left to a moderator's Edit. Rolls can
miss a rare appearance: one with a 10% chance is missed about 3% of the time, and if it has a
voice of its own the row confirms the other one, which a later `client` report cannot outrank.
And an NPC drawn with two bodies, like a Bluffwatcher, takes the voice of whichever body the
latest report saw.

An envelope carrying no `kind` resolves to nothing rather than being assumed a creature.
`ReportButton:TargetForGUID` accepts any GUID `Enums.GUID:CanHaveID` allows, which includes
`GameObject` — the sound packs ship `object_name_lookups.lua` for exactly those quest givers —
and such an envelope carries no `model` either, so the best row it could produce is a name we
already have. Filing a gameobject under a creature id would merge two id spaces that overlap:
creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster.

Reading such a contribution is different from writing it. The triage page, accept and the
export all look its id up under both kinds (`triage.ts:idOnlyResolution`): when the answers on
file agree, that answer is used, a moderator's first. When a creature and a gameobject sharing
the id disagree, nothing is used and the row shows the conflict; the moderator picks which one
the contribution meant, and that pick is stored on the contribution (`contribution.npcKind`,
migration 0033), never in `meta`, which stays what the client sent. From then on every reader
treats the row as if its envelope had carried the kind.

The answer is stored once per NPC in `npc` (migration 0070), keyed on the kind *and* the id for
that same reason, and every line reads its voice from it: a speaker row names the NPC, and a
line speaks in its speakers' race and gender and the flavor most of their NPCs have, as the
extract has always agreed one file on one voice. So one correction fixes every line that NPC
speaks, the extract's included, and their audio goes stale. The extract's own answers are the
`corpus` rows, which `import-corpus` writes from the corpus file's `npcs`: race and gender from
the display, and flavor from the NPC's greeting sounds. Where the game names none, as for
Cairne Bloodhoof's hand-made display, the import gives the race-gender's default ("standard",
or its busiest flavor) and marks the answer doubtful; the export writes it back without one.
Such an NPC keeps the voice its lines were made in and is listed under Doubtful on
`/npcs`, which lists every NPC, for an admin to confirm or change. Migration 0071 gave every
speaker's NPC an answer from its speaker rows; one with no type has no voice, and its lines wait.
`import-corpus` never replaces a moderator's answer unless a moderator marked it doubtful, even
with a moderator answer from the file, and lists every answer it kept over a different one.
A dump answer that knows only the creature's model (`model-77`) fills an NPC nobody answered
and updates its own kind, and leaves every other answer, a player's client included: a race
somebody named says more than a model, and replacing it would take the NPC's voice away.
Names are per language, in `entity_name`. A moderator can rename an NPC there, in the language their
rights are checked in (English unless the request names another), and the import leaves an
edited English name alone.

Every line several NPCs speak is spoken in each one's own voice. The file already made keeps
the voice it was made in, the one its speakers were written with; each other voice among them
is a line of its own, `{lineId}~{voice}` in a file `{fileName}-{voice}` (`naming.py`), listed
in the explorer and generated like any line. Changing an NPC's voice moves it to its new
voice's line. A pack points a giver at its voice's file only once that file has audio in the
store (`tts_cli/voice_files.py`). A quest giver is found through `QuestFileLookupByNPCID` and
`QuestFileLookupByObjectID`, and the addon falls back to the moment's own file when no
installed pack has it; a greeting's speaker and a follow-up's are looked up per NPC already, so
their tables simply name the speaker's own file. The greeting tables keyed by NPC name, used when
the addon has no id, name the line's own file, since same-named NPCs can differ in voice. Progress text is never voiced and never split.

An admin can add a speaker the game data lacks, from the explorer: the person icon under a
speaker's id adds another NPC who says that line, by kind and id. One nobody has answered is
answered in the same dialog, as `/npcs` would, since a speaker is written with its voice. The row
goes on each of the moment's lines (both sides of a player-gender split), marked with the admin
in `addedBy` (migration 0076), and shows as *added*. Like a contributed speaker, an added one
numbers from 1,000,000, is exported with its `addedBy`, and is kept by `corpus_db.py`'s import
until the dump has the same NPC on the same line (`lib/quests/speakers.ts`,
`api/quests/lines/speakers`).

The dump can also name the wrong speaker: a quest it says a gameobject offers is offered by a
creature. An admin takes a speaker off a line with the cross beside it, and puts another NPC in
its place with the arrows, through the same dialog, whichever source the speaker came from: the
dump, a contribution or an admin. A line's last speaker cannot be taken off, since a line is in the explorer only through its speakers: replace it instead, which adds
the new NPC before the old one goes. Taking off a speaker deletes its rows on
every line of the moment and records it in `quest_line_speaker_removed` (migration 0077), which
the import reads so it leaves that NPC off the moment from then on. The export carries those
records as `removedSpeakers`, written only once there is one. Adding the NPC back deletes the
record.

The line's file and takes stay as they were. A line's file was made in its first speaker's voice,
so when that speaker goes, the next one's row inherits the voice it is written with. Each
remaining speaker then keeps its own voice's line and takes. A replaced line shows as missing in
the new NPC's voice until it is generated, and a pack plays the old file for that NPC until then.

An NPC can be split by body. One creature id can be drawn as several races and both sexes: a
Stormwind City Guard is a man or a woman at even odds, and an Ironforge Reveler a dwarf, a
gnome or a human. A body is a race and a sex, and the client's `UnitSex` (2 for a man, 3 for a
woman) is the sex half of it. The `npc` row answers one race, gender and flavor for the id, so
every body used to speak in the first one's voice. A split NPC has a row per body in `npc_body`
(migration 0075, which took over `npc_sex`'s rows with the race of their NPC), and each row
answers that body's flavor under `npc`'s provenance rules; its gender is the sex's. Two or more
rows mean a split, and deleting the second-last unsplits it, the last row going with it. Every line the NPC speaks is then
spoken once per body, by the rule above: the body whose voice made the file keeps it, and each
other voice speaks `{lineId}~{voice}`. The `npc` row stays the answer for whatever does not
know the body.

The extract finds them in the game's data (`tts_cli/npc_bodies.py`). A creature has up to four
displays, each drawn by its probability and each with a race and sex, and the rest of the
extract reads only `display_id1`. A speaking creature whose displays include more than one body
is split: guards for the most part. A body's weight is the summed probability of its displays,
and its flavor is the one its displays' greeting sounds name most; a body with no greeting
sound gets its race-gender's default, marked doubtful, as an NPC does. vmangos has no per-spawn
displays, so a creature that only a spawn draws two ways, such as the Brigadier General, comes
from contributions. `make quests-import-npc-bodies` writes the same rows into a database that
is already filled, production included, without a whole extract. It keeps a moderator's answer,
and the stragglers it removes are only corpus-provenance rows nothing in the extract still
names: a moderator's lone body stays.

A contribution splits the NPCs the dump does not know. A greeting from a creature drawn as a
body its voice is not (the envelope's model against the `npc` row, or its `sex` where the model
is unknown) is not dropped as known, even when the NPC already says it, and storing it splits
the NPC (`npc/split.ts`): the NPC's answer becomes its own body's, and the body the player saw
is answered as `resolveNpc` answers from the client. The model's file id becomes a race through
`apps/web/src/lib/npc/character-models.json`, and where the model is unknown the body is the
sex alone, with the NPC's own race. Once the NPC is split the row reads as known again and
leaves the queue. On `/npcs` an admin sees each body under its NPC, answers it, and can split
by sex, add a body, remove one or unsplit any creature by hand (`api/npcs/body`).

Sex is the half of a body older addons know, so a sex with several bodies is voiced by the one
whose race is the `npc` row's, failing that the heaviest, ties going to the earliest answer (the
sex rule). The pack's sex tables are built by it. A pack finds a split NPC's line as it always
has, by its text, under the line's own stem, and then asks the body:
`GossipFileLookupByNPCBody[npcId][body][stem]` and `QuestFileLookupByNPCBody[stem][npcId][body]`
name the file each body hears, a body being written `{race}-{sex}`, as in `gnome-female`. A
body keeps the line's own file until its voice's has audio in the store, as any NPC does. A
follow-up is said in chat: `FollowupLookupByNPCBody[npcId][broadcastId][body]` names each
body's file, which plays when the speaker is a unit the player has up (the dialog's NPC, the
target, the mouseover). `NPCBodiesByNPCID` lists the bodies every speaking creature is voiced
as, and `BodyByModelFileID` turns a model's file id into the body it draws, built from
`character-models.json`. `GossipFileLookupByNPCSex`, `QuestFileLookupByNPCSex`,
`FollowupLookupByNPCSex`, `NPCSexByNPCID` and `FollowupLookup` still ship, derived by the sex
rule, for an addon that predates the split, which reads only them and plays the line's own
file where they are silent. The addon's gossip text (`gossip_text.py`) gives a
split NPC both forms of a BroadcastText row.

The addon reads the body from the creature's model (`NPCModel.lua`) and looks a line up by body,
then by sex, then in its own file. A model that has not loaded yet reads as no body, so a cold
model plays the sex's file. Priming a model costs a `SetUnit`, so it is done only where the
answer is used: on target and mouseover for creatures a pack splits (the gossip tables only),
and on dialog open for creatures in `NPCBodiesByNPCID` only when the contribute buttons are
shown or gathering is on, or when the creature is split. Every load is settled within about
two seconds by `C_Timer` polls. A load left before its model is in (the cursor swept on, the
target changed, two seconds passed) is not taken for a miss: the creature is loaded again when
next asked, two loads at most, and only the second coming back empty is remembered. `DataModules:IsOtherBody` tells the addon a creature
is drawn as a body its voice is not: the line still plays in the voice it has, and the
Contribute button offers it, so the site hears that the NPC comes in more than one body.

The corpus file carries the rows as `npcBodies` (schema 6: race, sex, weight, flavor), only for
NPCs with two or more, as the catalogue and the contribution check read only those: a row
alone, such as a moderator's body an import kept, splits nothing. A file of schema 5 with
`npcSexes` still imports, each row a body of its NPC's race.

`npc` also keeps what the client
reported even when a moderator overrules it — evidence about the NPC is worth more than the
guess it produced — along with the client build, since model ids are per-build data.

Precedence is enforced in the SQL rather than by whoever calls it: `moderator` outranks
`corpus`, which outranks `display`, which outranks `client`, which outranks `none`, and a write only lands when it ranks
at least as high as what is already there. A submission carrying less information can never
erase one carrying more — the case that matters is a player on an older addon, whose envelope
has no model at all, submitting for an NPC somebody else already resolved.

`corpus` means an *extracted* speaker: only the corpus import writes `corpus` rows, never the
speakers accepted contributions wrote. Those carry the NPC's own resolution at the time it was accepted, often a
`client` guess, and reading one back as `corpus` confirmed the guess and let it outrank the game's
own appearance data. Migration 0058 demoted the 71 rows that had been confirmed that way.

`/contributions` shows the result with its provenance and says plainly which rows are guesses;
answering who speaks a row there, like everything on `/npcs`, is a global admin's alone, since
it picks the voice in every language, and everyone else sees "Missing NPC", "Missing type" or
the answer. A missing NPC is answered with its kind (creature, gameobject or item, the Wowhead
`npc=`, `object=` or `item=` page), its id and its name; a gameobject or an item takes its own
kind as its type. A new type, gender or flavor is added on `/npcs` → Types, with a voice of its own
or an existing one (a treant could be read by the narrator): that puts it in the selects and
gives a new voice a slot on `/voices`, marked as not existing in the account until it is cloned.
`import-corpus` adds any type the file names that the database lacks, and never changes one it
has. A first gender for a genderless type, or a first flavor for a race-gender read by one
bare voice, splits a voice NPCs may already speak with, so the Types tab asks first: map it to
the new combination (its files and takes stay valid, and the type's NPCs move there) or throw
it away (the new combination gets a new voice; the old one and its takes stay on file unused,
and the NPCs wait for an answer).

`/contributions/game-data`, unlinked and collaborator-only, resolves NPCs from a game client
instead of by hand. It lists chat commands that make the client ask its server about every
unresolved NPC. The answers land in the client's `creaturecache.wdb`, which the page reads in
the browser for each NPC's appearance ids. The server turns those into voices with
`apps/web/src/lib/npc/display-voices.json`, and **Apply** writes them as moderator answers.
The voice set decides over the model, because it is what the player hears.

#### Which greeting a text is: BroadcastText ids

A gossip line's id hashes its English text, so a greeting seen in another language cannot be
matched to its line by its words. The game has a language-neutral id for it, the BroadcastText
row the server sent. No client API returns that id (a probe on Forever 1.60.1.70291 found
nothing in `C_GossipInfo`, `GOSSIP_SHOW` or any event while the window was open), but the
client writes every row it is sent to `Cache/ADB/<locale>/DBCache.bin`, with the id. Forever's
client ships almost none of the table, so every greeting a player sees passes through there.

`broadcast_text` (migration 0066) keeps those rows per language. `/contribute` takes
`DBCache.bin` and its per-session `DBCache.bin<n>.tmp` files from signed-in players, reads them
in the browser (`apps/web/src/lib/broadcast/cache.ts`) and posts only the BroadcastText rows to
`/api/broadcast-text`. A cache says nothing about its language except the folder it sat in, so
the player picks it, and a non-English upload that mostly matches English under the same ids is
refused.

A row's text is replaced only by one from the same or a newer client build, because a hotfix
edits a row in place and keeps its id. One text can sit under several ids ("What are you
looking for?" is 4857, 5907 and 6788); they read alike, so whichever matches is as good as the
others.

`gossip_broadcast` (migration 0067) names the ids each gossip line speaks, one set per line for
every language. `matchedBy` says how it was found: `extract` when the world database names the
id for the line's NPC, `text` when the line's English text equals the id's English text, which
is how Forever's greetings get one. A one-off filled both tables in October 2026: `broadcast_text`
with vmangos's rows in English and its eight locales (no ptBR) as build 5875, and with
[EG Link](https://github.com/JIVESCORP/eg-link-output-wowf)'s English Forever rows; then 3,572
gossip lines by extract and 178 by text. The 508 left are quest greetings, which have no
BroadcastText row, and Forever lines no source had yet.

#### Gossip text for every client, and one moment under several names

The addon carries every line's gossip text for each client locale but English,
`addons/Spoken_Quests/Gossip/<lang>.lua`, each returning before it builds anything on a client
in another locale, and asks it before any pack's tables. It lives in the addon, not the packs,
for the giver names' reason: the text follows the client and the voice is any language, so a
German client with English or Portuguese packs finds its line the same way. Each file is about
2 MiB of Lua, and a guard returns only after the client has parsed the file, so Forever's `.toc`
files list each one with `[AllowLoadTextLocale <lang>]` (a per-file directive from 11.1.5) and
the client loads only its own. The classic `.toc` files load `Gossip/Gossip.xml`,
which lists all nine (about 14 MiB, 2 MiB of it ever built).
`make quests-export-gossip-text` writes them (`tts_cli/gossip_text.py`) from three sources: a
translation row while it translates the line's current English, the line's own text when it has
no English, and `broadcast_text` in that language for each id the line has, in the form the
speaker's sex shows. Rerun it after an `import-locale`, a cache upload or a relink.

New gossip lines get two more id forms (`tts_cli/naming.py`), for lines with no English to hash:
`g:b{broadcastTextId}-{voice}` when the id is known as the line is made, else
`g:{lang}-{md5(text + race + gender)}`. A moment is the lines sharing an id and a race and
gender, and when it has several, `Gossip/Aliases.lua` lists each one's siblings. The addon
tries a line's own file and then its aliases, within each language, so a take in the chosen
language under a sibling's name beats the fallback language under the line's own. Lines are
linked this way and never renamed.

The packs' own `generated/<lang>/` copies keep loading, for players on an older addon, and the
addon's text outranks them.

**Relinking** (`apps/web/src/lib/broadcast/relink.ts`) upgrades lines as ids arrive. Every cache
upload runs it for its language. It gives a line with no id the lowest id that reads the same in
one of its languages, then merges duplicates: two lines of one id with the same speakers that
read the same in every language both have, which is what a moment minted twice before its id
was known looks like. The line kept is the one named by id, then English, then a language's own,
then the older. It takes the other's languages it lacks. The other's rows stop being current, and
`gossip_merge` (migration 0068) records where it went. Its file is never renamed: it becomes an
alias of the line kept, so its takes still play, `corpus/gossip_aliases.json` tells the pack build
to ship them, and a link to it shows the line kept. Lines of one moment that read differently
stay apart, and the explorer's Quest / broadcast column links each to the others as "same moment". To run
it over every line, use `apps/web/scripts/relink-gossip.mts`; `--dry-run` lists what it would merge.

#### A quest moment in more than one wording

The game can show one quest moment in different words: another giver offers the same quest,
or one NPC words it differently for another race, class or faction. The corpus keeps each as
a line of its own. The first keeps the moment's id and file; each other is
`q:{quest}:{event}:w{n}`, file `{quest}-{event}-w{n}` (naming.py), numbered across languages
so a translation shares its English's id.

A correction whose text is such a wording, not a fix, is accepted on the corrections tab with
**Accept as new line**: the corpus line stays and the player's text becomes the moment's next
wording in its language, spoken by the NPC that showed it (`correction.ts` acceptAsWording).
A correction of a moment with several wordings lists them all under "Corpus has", the closest
to the player's text picked; **Accept** fixes the picked one, and clicking another picks it.

The packs map each wording's text to its file by the moment's stem (`QuestWordingLookup`), and
each client locale's `Gossip/<locale>.lua` carries the same in its own text. Only a moment with
two or more wordings gets an entry. The addon matches the quest window's text against them as
it matches gossip (similarity 0.7); below that it plays nothing and offers Contribute. A client
whose language has fewer than two wordings of a moment plays the moment's file, as before.
Progress text is kept but never voiced.

## Addon Install

```bash
python cli-main.py install --force --addons "<WoW folder>/_classic_beta_/Interface/AddOns"
```

`install` copies a built pack from `dist/` into the AddOns folder. Its default is a macOS
`_classic_era_` folder, so pass `--addons` for Forever (`_classic_beta_`). It moves any existing
install aside to `<module>.replaced` rather than deleting it. The addons are `addons/Spoken` and
the modules beside it, and Quests needs Spoken. To run a checkout's code, the repo's
`/link-addon` skill links every addon folder into a client (`beta`, the default, is Forever)
and `/reload` loads it. It skips the audio packs, whose mp3s are not in git, so install a pack
with the command above.

Use `Spoken_Quests` and not upstream's `AI_VoiceOver/`, which calls
`GetNumAddOns`, `GetAddOnMetadata` and `LoadAddOn`, which Blizzard moved to `C_AddOns` in
10.2 and removed in 11.0.2, so on Classic Era 1.15.9 it errors while enumerating and the
sound pack never registers. Install one player, never two — two copies fight over the same
saved variables and the same sound queue. `SUPERSEDED_PLAYERS` at the top of `VoiceOver.lua`
pairs upstream's players with the folders they install into — `AI_VoiceOver` and
`AI_VoiceOver_Continued` — and each one found is stopped by AceAddon name for the session and
disabled by folder for the next login. This project's own old folder, `VoiceOverRedux`, is
Spoken's to find (`OLD_FOLDERS` in `addons/Spoken/Core.lua`), which asks the player to delete
it.

**A player counts as a duplicate when it has registered, not when its folder is present.**
The folder proves nothing: earlier releases shipped an empty `VoiceOverRedux` placeholder
inside this addon's own zip, and a fresh install opened with a dialog about
an addon nobody had installed — and, behind it, the client's own *blocked from an action only
available to the Blizzard UI* dialog, because enabling and disabling addons is reserved for
Blizzard's UI on current clients and `DisableAddOn` had been called on a folder with nothing
to disable. Asking AceAddon answers the question that matters, which is whether the old
player's code is running; the same test is why an old install the player switched off
themselves is no longer described to them as enabled. `DisableAddOn` is called through `pcall`
for the same reason: a client that refuses it raises an error along with that dialog, and the
quest hooks after it still have to be installed.

**The rename.** The player was `AI_VoiceOver_Continued` and the pack `AI_VoiceOverData_Vanilla`
until this project had diverged far enough from upstream that carrying its name was
misleading; they became `VoiceOverRedux` and `VoiceOverReduxAudio`, and are `SpokenQuests` and
`SpokenQuestsAudio` since 2.0.0. The module's folder has been `Spoken_Quests` since 3.0.0-beta.3;
an old `SpokenQuests` copy left on disk is switched off by Spoken at login. An old pack still works —
the player finds packs by the `X-SpokenQuests-DataModule-Version` key in the TOC, or the inherited `X-VoiceOver-DataModule-Version` that every shipped pack carries, not by name
(`DataModules:EnumerateAddons`) — but settings do not survive, because `SavedVariables` live in
`WTF/…/SavedVariables/<folder>.lua` and the folder is the identity.

**The pack is nested under Spoken in the AddOns list** by `## Group: Spoken` in both
TOCs, as is every other addon and pack of the project — the value is the main addon's *name*,
so it is the folder rather than the title. It named `SpokenQuests` until 3.0.
That tag arrived in 11.1.0; the `X-Part-Of` and `X-Child-Of` lines beside it are custom `X-`
fields the client never reads, kept because addon managers do and because upstream shipped
them.

The data module names no `RequiredDeps`. It used to require `AI_VoiceOver`, which made
`LoadAddOn` fail with `DEP_DISABLED` whenever the player was a fork under another folder name
and the original sat disabled — three folder names into this lineage, that is the normal case. The module is `LoadOnDemand` and its `Module.lua` returns early
unless `VoiceOver.DataModules` exists, so the dependency bought nothing and cost the fork.

### What NPCs say after a quest

Some quests end, or begin, with the NPC saying something in `/say`, `/yell` or a whisper a few seconds
later: the world DB's quest scripts, which the client only ever sees as
`CHAT_MSG_MONSTER_SAY`/`_YELL`/`_WHISPER`. `FollowupLines.lua` is the export of those lines
(`pipelines/quests/tools/export_followup_lines.py`), keyed by quest under `end` and `start`,
and `Followup.lua` reads them. A quest script that hands off to a `generic_scripts` script
(START_SCRIPT) has that script's lines exported as its own, at the hand-off's delay plus theirs
and spoken by whoever the hand-off ran it as - Thrall after For The Horde!, the Scarlet
Cavaliers after Scarlet Subterfuge; `pipelines/quests/tts_cli/followup.py` has the rules. That chat reaches everybody near the NPC, and in a capital the
same turn-in happens every few seconds, so nothing is listened for until **this** player
triggers it: `QUEST_TURNED_IN`/`QUEST_ACCEPTED`. The quest's lines stay armed for their longest delay plus ten
seconds. On an English client a message must then equal a line once `$n`, `$r`, `$c` and `$g…;`
are filled in for the local player - so a line naming the player cannot match somebody
else's turn-in - and come from the line's speaker when the chat event carries a GUID. Other
clients show translated text, so there the speaker's NPC ID is the only evidence: the earliest
step still armed for that NPC plays, and with no GUID nothing plays. A script step can pick
one of several texts at random, and the export lists each as its own entry under one `step`,
so a match consumes every entry of that step. The step is exported rather than inferred from
speaker and delay because several NPCs of one entry can each say their own line in the same
second - Scarlet Subterfuge's cavaliers - and on a translated client the speaker-only match
advances step by step. Say, yell, zone yell and whisper lines are exported (a zone yell
arrives as `CHAT_MSG_MONSTER_YELL`, a whisper as `CHAT_MSG_MONSTER_WHISPER` or
`CHAT_MSG_RAID_BOSS_WHISPER`); emotes are not, having no voice. A whisper is addressed to this
player, but is still heard only while armed. It has its own setting, and
autoplay off silences it too, since these lines read themselves.

The recordings ship in the audio packs like every other line, and are generated on the site
like every other line. A pack's data module carries `FollowupLookup`, speaker's creature entry
to broadcast text id to file stem (`{broadcastTextId}-{voice}`: NPCs of one race-gender-flavor saying the same text share a
file, and a different voice gets its own), and the files sit under `generated\sounds\followup\`. The lookup only
names the file: `DataModules:ResolveSoundFile` picks the pack, so a follow-up line gets the same
language order, fallback and `m-`/`f-` player-gender variant as a quest line. A speaker with
no humanoid display - Kum'isha, a Broken, or the OOX robots - has no race or sex to voice it
by, so it is voiced by its model: the voice is `model-{ModelID}`, shared by every NPC drawn with
that model (`f:3475:model-29`, `followup/3475-model-29`). Those lines are in the corpus but
marked `no-voice`, and the site will not generate them until a voice is chosen for the model.
Where no installed
pack has the line - every pack built before follow-up lines were recorded, a line the site has
not voiced yet, or a line only the fallback language has with the fallback set to none -
nothing plays: a borrowed gossip or quest clip would say other words under this line's text.
The debug log records `followup-no-recording` with the line's id, and `/spq followup` marks
such a line "no recording yet — silent". A clip that does play is queued behind the turn-in's
own voiceover rather than over it. Report on a follow-up line files it under the speaker's `npc/{id}`, since the clip
carries the speaker and no quest id: by the time the NPC speaks the quest dialog has closed. On the site the explorer
files one under the speaker's `npc/{id}` address with the line's id, the way it files gossip -
`quest/{id}/complete` would name the turn-in text instead. The explorer marks these rows with an
amber speech bubble and "after quest {id}", and the source filter calls them "follow-up"; it
cannot say whether the line follows the accept or the turn-in, since the corpus row keeps only
the quest.

### The Quests tab of Azeroth's Compendium

Azeroth's Compendium is Spoken's window (`addons/Spoken/UI/Compendium.lua`, its pages scrolling
in Spoken's `UI/TextView.lua`). `UI/QuestsTab.lua` adds a Quests tab to it once the world is up,
first, before Places and Readables; it needs Spoken and no other module. `Compendium.xml` loads
the tab and its data from every `.toc` file (Forever, Classic Era and TBC Anniversary).

Two generated files feed it, both committed so the addon never needs a database:

- `Data/Compendium.lua` (`make quests-compendium`, `tools/export_compendium.py`): every corpus
  quest with its English title, its zone as uiMapIDs (the quest log's zone, a dungeon counting as
  the zone of its entrance, else where its giver stands: the area the repack's map files put the
  spawn in, `COMPENDIUM_MAPS` (the repack's `data/maps` folder; the run with the DB stops
  without it, `--no-db` uses the rectangles), as the readables' places have it, else the smallest zone
  rectangle where no tile was extracted, and a city's rectangle over the ground around it), or the QuestSort of a class, profession
  or season with its name in every language, and the races and classes allowed to take it. Areas,
  zones and sorts are read from Forever's client tables (build 1.60.1.70338 on wago.tools, pinned
  in `pipelines/lib/wago.mjs` and cached in `pipelines/lib/cache/wago/` for every pipeline), which
  have Forever's zones and sorts (Zephras Isle, Darkspear Islands,
  Camping, The High Order); Era's (1.15.9.69109) fill in anything they lack. The
  zone and who may take it come from the Forever repack's TrinityCore world DB
  (`COMPENDIUM_MYSQL_*`), since the vmangos extraction keeps neither. `ARGS=--no-db` keeps the
  quests already listed and adds the corpus's new ones, placed by their giver's spawn and open to
  the races of the side `corpus/factions.json` gives them.
  A quest the quest log files under a dungeon or a raid (`DUNGEONS`) is placed in the zone of its
  entrance, wherever its giver stands, with `dungeon`, the dungeon's map: its QuestSortID is the
  dungeon's own area, an area of its map, or an area of its name (Gnomeregan's quests are under
  133, an area of Dun Morogh), else the client's `zoneAreaId` is (`Maps.dungeon_of_area`). The
  dungeons, their entrances' zones and the other instances come from `pipelines/lib/dungeons.json`,
  which the readables' places read too; their names in every language are Spoken's
  `Data/Dungeons.lua` (`make dungeons`). The Excavation Site in the Wetlands is an instance of the
  Wetlands' own quests, not a dungeon.
  Battleground quests are under the battleground: the quest log files a few under an area of its
  name outside it (`Maps.battleground_of_area`), and a battlemaster's next quest, which it files
  under no zone or his city, follows the one before it from him (`battleground_follow_ups`). A
  giver found in four zones or more (any chicken, a battlemaster in every capital) places its
  quest nowhere (`GENERIC_GIVER_ZONES`).
  `races` keeps a mask's playable bits (`ChrRaces.PlayableRaceBit`): Classic's eight, bits 0-7,
  and Forever's Skyborne, 32 (High Order, Alliance) and 33 (Windshaper, Horde), all below 2^53 so
  a Lua number holds them exactly. The DB's masks are read as Forever's client has them
  (`db_races`): one naming every Classic race is anyone (the client has the DB's 0xFF and
  0xFFFFFFFF as everyone), and one side's four Classic races are that side's Skyborne too. The
  tab tests the bit with arithmetic, `bit.band` being 32-bit, and maps race ids
  95 and 96 to bits 32 and 33 (`Has` in `UI/QuestsTab.lua`).
  Most quests one side's giver hands out are open to every race in the DB (`AllowableRaces` 0 or
  all), so where the DB says anyone, the quest takes the side `corpus/factions.json` gives it,
  and failing that the side of the quest before it in its chain: a follow-up is reached only
  through that quest (`quest_races`). Failing both, it takes the side of the NPCs that start it in
  the repack (`creature_queststarter`, `gameobject_queststarter`, else the corpus's speaker of its
  accept line), or for a quest nothing starts (an item does) of those it is handed in to
  (`giver_sides`): an NPC whose client `FactionTemplate` is hostile to one side only is the
  other's (`npc_side`, the rule `tools/export_factions.py` has), and one hostile to neither, as
  Ruul Snowhoof, leaves the quest to both. An NPC the repack lacks says nothing. The export
  prints how many quests are still not on the side of the quest before them (`side_leaks`, the
  audit's leak check).
  A quest filed under a class's QuestSort that the DB names no class for is that class's
  (`quest_classes`): Forever's class quests are not in the DB, and without it every class would
  see them under the class.
  Each quest that follows another in a chain has `prev`, the quest before it, from the same DB's
  `quest_template_addon` (`chain_links`): a positive `PrevQuestID`; else the lowest quest whose
  `NextQuestID` names it (an `ExclusiveGroup` of several leaves that one); else the breadcrumb
  whose `BreadcrumbForQuestId` names it, where the DB has that column. A negative `PrevQuestID`
  (the other quest only has to be in the log) is no link. Quests the corpus lacks are passed
  through, and a link closing a loop is dropped. Last, after the client's links below, a quest
  follows the one whose `RewardNextQuest` offers it on hand-in, where that is the only quest of
  the corpus offering it (5 Jitters' Growling Gut after 163 Raven Hill): an offer is no
  prerequisite, so one offered after several (Summon Felsteed) or after a quest the corpus lacks
  follows none. `--no-db` keeps the links already written.
  Each quest handed in to another than its giver has `ender`, the creature it is handed in to
  (`enderObject` for an object), from the same DB's `creature_questender` and
  `gameobject_questender` (`quest_enders`): of several, the one the corpus has saying its progress
  or complete line, else its giver, else the lowest creature, then the lowest object. A quest the
  DB names no one for takes that speaker, and so do the quests `--no-db` adds. The giver it is
  compared with is the corpus's speaker of the accept line, as the packs' quest log tables have it.
  The DB has almost none of Forever's own quests, so after it comes Forever's client, as players
  recorded it: Efficient Games' open data ([EG Link output](https://github.com/JIVESCORP/eg-link-output-wowf),
  CC BY 4.0, credited in `THIRD_PARTY.md`), `quests.enUS.json` and `npcs.json` of every
  `wow_classic_beta` build, the latest build's record of a quest winning. Its `zoneAreaId` (a zone
  through Forever's tables) or `categoryId` (a QuestSort) places a quest the DB does not, before
  the giver's spawn, and its `zoneAreaId` wins where the DB's QuestSortID is in another zone,
  neither being a battleground's (Forever moved 540, 545 and 952); a `zoneAreaId` of a Forever
  area no map shows is placed where players saw its giver (`npcs.json` `offers`, else `takes`, by
  `positions[].uiMap`). Its `raceMask` limits a
  quest the DB opens to everyone, before `factions.json`, and wins over the DB's mask where both
  limit (`race_mask`): it gives Skyborne druids their class quests and takes Desperate Prayer from
  human priests, while a `raceMask` of anyone changes nothing. Its `nextQuestId` links a quest no
  DB link reaches, and the client's quest lines (`QuestLineXQuest`, by `OrderIndex`,
  `quest_line_links`) link a quest neither reaches, as Toxic Soil in Westfall. Otherwise it adds to what the DB says. The files are read at one commit
  of their repository (`EG_COMMIT`), since it grows every day and an export run twice must give
  the same file; they are fetched once into `tools/cache/efficient-games/<commit>/` and read from
  there after, offline too. Moving the commit is a deliberate change whose diff is reviewed.
  The file's header names the client builds and the commit it was made from.
  `--without-efficient-games` leaves it out.
  Forever serves quests the corpus has no lines for yet. Each one players were seen being offered
  or handing in (`npcs.json` `offers`, `takes`) or working on (`objectives.json`), and that the
  client data has a title for, is listed with `notext = true` (`served_quests`, `without_text`):
  placed, limited and linked by its client record as above (a dungeon's under its dungeon, by its
  `zoneAreaId`, as a quest with words is), so the tab lists it with no words
  until its lines reach the corpus and an export drops the flag. The tab does not read the flag:
  a quest with no lines in `SpokenQuestsText` is one with no words, and its page says so
  (the shared "Nothing has been written for this yet." with Contribute). `--no-db` makes these again on
  every run; the hand corrections' removals are never listed.
  Last come the hand corrections, `corpus/compendium_overrides.json` (`load_overrides`,
  `apply_overrides`, `chain_names`): what neither the DB nor the client data can say, such as a
  breadcrumb's link, a quest the beta removed, or a chain's name. Each `quests` entry names its
  quest (`id`) or quests (`ids`) and sets any of `title`, `zones` (uiMapIDs, taking the quest out
  of its sort), `sort` (a QuestSort, or the word of a group the client has none for, such as
  `"winterveil"`; 0 for none), `prev` (0 for none), `races`, `classes` and `remove: true`; each
  `chains` entry names a quest of a chain and the chain's `name`, a quest's id (the client gives
  its title in its own language) or words with their translations in `names`. Every entry has a
  `source`, the wiki page or the reason, for a reviewer to check; the export refuses one without.
  Entries apply in order, so a later one wins. A quest dropped is passed through by the quests
  after it; an entry for a quest the corpus lacks is printed, not applied, since a quest needs
  its lines in the corpus before it can be listed. A chain's name is written as `name` on its
  first quest, so it is the chain's in every zone it crosses. With `--no-db` the quest entries
  apply to every quest again (each line read back, `parse_quest_line`), so a correction written
  since the last run with the database takes effect; the chain entries apply to the quests added.
- `Data/QuestText.lua` (`make quests-compendium-text`, `tools/export_quest_text.py`, rules in
  `tts_cli/quest_text.py`): each quest's accept and complete text (its progress only where it has neither, as its accept), the corpus's
  `originalText` with `$N`, `$C`, `$R`, `$G male:female;` and `$B` kept (the addon writes `$c` and
  `$r` in lower case, as the client does, save on a German client). An objective's amount, a
  Craftsman's Writ's `$2oa`, is written in from Efficient Games' objectives (the same cache as
  `Data/Compendium.lua`'s; `--without-efficient-games` leaves it). A gendered pair is one
  text; where givers' texts differ, the one most of the moment's lines have, ties to the first in
  the corpus; ignored lines, and the quests the hand corrections `remove`, are left out. About 2.8 MB, parsed at every login on those clients.

The tab lists only the quests this character's race and class may take. A quest is found once
the client says it is completed (`C_QuestLog.GetAllCompletedQuestIDs`, else
`GetQuestsCompleted`, else `IsQuestFlaggedCompleted` one at a time) or while it is in the quest
log (`C_QuestLog.GetInfo` where the client has it, else `GetQuestLogTitle`; where a collapsed
header hides some, `C_QuestLog.IsOnQuest` for each quest). A quest in the log and not completed
is in progress: the gossip window's quest mark before its title, and the mark and "In progress"
after where it is on its page; zone and group counts include it, and a page's count says how many of them
are in progress. The list follows the log while it is open (`QUEST_LOG_UPDATE`,
`QUEST_ACCEPTED`, `QUEST_REMOVED`, drawn again once a burst is over and only when the log's
quests changed). The rest are locked unless Unlock Unstarted Quests is on, which Spoken's page
shows in its Compendium section. The filter menu holds Started Only, on until it is turned off (`FoundOnly` unset reads as on; the setting is the account's), and Voiced Only, which leaves
out the quests no voice pack has the offer or the hand-in of, with any line or banner left with nothing, and counts
only what it lists. That switch and both filters are kept in
`SpokenQuestsSettings.global.Compendium`.

The list is the Compendium's banners and lines. Its top level is a banner for each continent, holding a line
for each zone with quests (a city a line inside its zone's); an Other Lands banner holding
a line for each zone on no continent the client knows (Zephras Isle, whose map hangs under
Azeroth), as the Places tab lists them; a Battlegrounds banner holding Alterac Valley, Warsong
Gulch, Arathi Basin and Darkspear Islands, whatever map the client hangs them under (Forever's
newer client puts Alterac Valley in Hillsbrad Foothills, its older one under Azeroth, where no
continent's list reached it); a map the client has never heard of (Forever's Zephras Isle and
Darkspear Islands on Era) has no line, and its quests are neither listed nor counted; then a
banner each for Classes, Professions (Camping, 666, with them: its quests are Camping 101 for
one profession or another), Holidays and Events and Other, holding a line of the list for each
class, profession, season or other QuestSort, and Place Unknown under Other. Banners are for
continents and types, and everything else, places included, is a
line of the list with what it holds under it. The tab names some groups itself (`GROUP_NAMES`):
Special (284) is Children's Week, under Events, as it holds nothing else; Reputation (367) is
Commendation Signets, its hand-ins; Invasion (368) is Scourge Invasion, as the German and
Chinese clients call it; and the groups the client has no QuestSort for, a word in the data
(`winterveil`, `hallowsend`, `loveisintheair` and `harvestfestival` under Events, `argentdawn`
and `library` under Other), take their names from the strings. Inside a zone, its
dungeons' and raids' quests (those with `dungeon`) are the dungeon's line, named as Spoken's
`Data/Dungeons.lua` names it in the client's language; where the zone has several (Searing Gorge
holds Blackrock Mountain's four) they are a line of the list, Dungeons and Raids, with a line
for each dungeon under it.
The tab lands on the player's zone, opened; where it has no quests, or Started Only or Voiced
Only leaves it out, on the player's continent, as Places and Readables land, else on the first continent
listed (there is no Azeroth row). A switch in the filter menu that leaves out the chosen row
(`onHidden`) lands again where the tab chose it, and otherwise chooses the nearest row above it
that is still listed: a quest's zone or group, a zone's continent. The list is drawn in the game's own art
(`UI/Compendium.lua`, plain colours where a client lacks an atlas): a banner is the objective
tracker's campaign header for the player's faction, without its crest. A zone's or a dungeon's line has its
plus or minus and its name, and on its right the quest mark with how many of its quests
are in progress, the quests completed out of all and the share completed (or, once all are, the
quest log's gold tick). Its picture is on its page. A banner counts
completed out of all. A quest's row has the gold tick once completed and the quest mark while in progress.
Chosen, a banner's or line's page has one line under its name, what holds it and its
count, parted by " · ". A place is "In" its holder ("In Eastern Kingdoms · 1 of 88 completed, 2 in
progress"): a zone is in its continent, Other Lands or Battlegrounds, a city in its zone, a
continent, Other Lands and Battlegrounds in Azeroth, and a dungeon in the zone of its entrance. A class, profession or season
and Place Unknown are no place, and are named as they are: their line names their section
("Classes · 3 of 7 completed"), and a chain's line under one names it ("Mage · …"). The sections
have nothing above them, and their line is the count alone. A quest's page says where it is: "In"
its zones (the first two, and how many more: "In Elwynn Forest, Westfall and 1 more"), else its
section and its group ("Classes · Mage"), else "Other · Place Unknown". Where something holds
what is chosen, the line is plain words: it leads nowhere.

In each zone, class, profession, season or Place Unknown, the quests of one chain (two or more
there, linked by `prev`) are a line of the list of their own, before the quests in no chain. The
line has the chain's name, the same in every zone the chain crosses: the `name` the data gives the
chain's first quest (a quest's id, whose title the client gives in its own language, or words by
language), else the title of the chain's first quest this character may take, wherever that
quest is (`ChainName`): Rude Awakening, the Undead's, does not name the chain an Orc joins later.
Where one place has two or more chains of one name (Warsong Gulch's six Fight for Warsong Gulch),
each is numbered on its line and its page, "Fight for Warsong Gulch (2)", in the order of their
first quests' ids. Its numbers count its quests as a zone's line
does. A chain that runs through several zones has a line in each, for its quests there. Chosen, a chain's page has
its name, what lists it (the zone, dungeon or group that holds it) and how many of its quests
are completed and in progress, and asks for one of its quests
to be chosen from the list; it has no Play. The client has no chain of its own, so without `prev`
in the data every quest is a row of its own.

The page fills the placeholders for the player as the client does. A started quest's page shows
its offer; its hand-in, with its Play and Report, shows only once the quest is completed, or with
Unlock Unstarted Quests on, since it tells how the quest ends. The progress, said while the quest
is under way, has no part on the page: it is not shown or played there, and Voiced Only counts
only the offer and the hand-in, so a quest voiced only in its progress counts as unvoiced. Each
part's Play plays that part. A part is named and pictured for who says it: the offer for the
quest's giver, as the quest log's Play is, and the hand-in for the one it is handed in to
(`ender` or `enderObject`, else the giver). The offer's part is named Description, by the
client's own `QUEST_DESCRIPTION` (the heading of a quest's text in its quest window) where it has
one, else `L.QUEST_PART_ACCEPT`; the hand-in's is Completion. Each part is headed as
the Small Window heads a line, with DialogueUI installed or not: the speaker's round face
(`Spoken:CreateSpeakerFace`, 44 across) with the part's badge, their name over the part's name
beside it, the two centred on the face together, and the part's Report (every part, voiced or
not: the site's report page takes a line with no recording) and its Play (where a pack voices
it) at the right on the face's middle. A creature the client has not cached
shows the book until it has, one never cached or no one known keeps the book, and an object or
an item shows the quest's item, else a posted notice. Shift-click on a quest's row hands its first part
shown that a pack voices (its accept line, else its complete line) to `Player:Enqueue`, behind
what the queue holds, and leaves the selection and the page as they were; a line already queued
is not queued again. The page shown with no quest chosen says so.

A zone's, city's, continent's or dungeon's page has no words of its own: its count under the title,
and the faction's seal. Its story is on the Places tab.

Open in Azeroth's Compendium (`UI/OpenInCompendium.lua`) is Spoken Places' lore-page button for
quests: the Compendium's tome in the player's round button, opening the tab on the quest with its
zone, continent or group opened and its page shown (`QuestsTab:Open(questID)`), though Started
Only or Voiced Only leaves its row out of the list, which keeps its filters. It shows, with Quests
on, for a quest this character may take whose page shows its words: started, or any with Unlock
Unstarted Quests on, and switching that refreshes the buttons on the windows open. It is on the
quest giver's window, left of Listen or Contribute
in the strip under the close button, or in that corner; in Classic Era's quest log, at the top
right of the selected quest's details; in the map's quest log (Forever), left of the details
view's Play, Report or Contribute; and in DialogueUI's window, at the left end of Spoken's row on
a quest page (`UI/DialogueUIBridge.lua`). DialogueUI hides the rest of the interface while it is
up, so that one closes DialogueUI's window before the Compendium opens.

On a client in another language, `QUEST_DETAIL` and `QUEST_COMPLETE` keep the window's title and
words in `SpokenQuestsSettings.global.CompendiumText[locale][questID]`, shown over the English;
`QUEST_PROGRESS` keeps the title alone. The player's name, class and race go back to `$N`, `$C` and `$R` where the
English has them, so another character sees its own. A text kept by a character of the other sex
is not shown where the English has a `$G`. An English client keeps nothing.

## Tests

```bash
cd pipelines/quests
pip install -r requirements-dev.txt && pytest       # the pipeline
```

```bash
pnpm -r typecheck && pnpm -r test                   # the sites
make test-player                                    # the addons, needs luajit
```

`make test` from the repo root runs all three.

**`tests/test_corpus.py` is skipped unless pandas is installed.** It builds a real DataFrame,
because that is what the extraction hands `build_corpus` and the dtypes are half of what that
function has to survive — but pandas belongs to `requirements-extract.txt`, and the pin there
(1.5.3) has no wheel for this project's Python and does not build from source on it. So that
module declares the dependency with `pytest.importorskip` rather than at the top of the file:
a missing import at collection time fails the entire run before any other module is collected,
which is how one absent package came to report the whole suite as broken. Install the extract
requirements on a Python they build for and the module runs.

`make test-player` runs the player's quest dispatch against a stubbed client
(`tests/lua/wow_client_stub.lua`), on LuaJIT because it speaks the same Lua 5.1 the game does.
The stub owns the clock, so the 10 Hz watcher that decides which line a quest interaction reads
can be stepped through a whole hand-off deterministically. It exists for one class of bug: an
addon that replaces the quest frame — DialogueUI calls `QuestFrame:UnregisterAllEvents()` —
leaves every Blizzard quest panel hidden, and the player used to read such an interaction as an
offer, so turning a quest in replayed its accept line and the completion line never played at
all. Panels still classify an interaction when they are visible; when none is, the last quest
event the client fired decides, and `QUEST_FINISHED` clears it.

The second class is the opposite problem: an addon that answers the quest event itself. Leatrix
Plus calls `AcceptQuest` from its own `QUEST_DETAIL` handler, and the auto-turn-in addons do
the same with `CompleteQuest` and `GetQuestReward`, so the dialog is over in the frame it
opened in — `GetQuestID` is back to 0 before the watcher's first poll, and the interaction was
never read at all. The quest globals are therefore snapshotted when the client fires each quest
event, which is the last moment they still describe it, one record per page: an auto turn-in
shows the progress and the reward page before the watcher can read either, and both are read,
in order. The watcher replays the pages nothing read when the quest ID drops to 0: of each
kind of page, the newest, and not an offer recorded after its own quest's progress or reward
pages, which carries the globals of the quest just handed in. The pages it passes over wait for
their own accept or turn-in. Two events replay pages too: `QUEST_ACCEPTED` replays the quest's offer and `QUEST_TURNED_IN` its progress and reward
pages, found by the quest ID in the event. That ID is the first argument on the Forever client
and the second on Classic clients, which send the quest log index first; a secret ID replays
nothing. They cover a client that keeps reporting the quest ID after the dialog closed. A page
recorded with neither a quest ID nor a title names no quest and is not kept, since no later
event could tie it to one. A declined quest sends neither event, so a decline reads what it did
before. Records live ten seconds. It is a fallback, not a second dispatcher: a page the player
reads in the open dialog is dispatched by the watcher as before. That page is the newest record
of its event, whatever quest the globals named when the event arrived, and it and the earlier
pages of the quest the watcher read are marked read; another quest's pages still wait for their
own event. A page shown again keeps its mark. A replay bypasses DialogueUI's wait for its window
and reads the record, whatever else is open, and no window's close stops it.

`tests/lua/quest_overlay_test.lua` covers the other thing the quest UI owes a player: the play
button beside each quest in the quest log. There are two quest logs to draw it in. The old one
is a named frame with numbered title rows (`QuestLogTitle1`…), redrawn through `QuestLog_Update`
— what Classic Era has, and what `QuestOverlayUI` was written
against. The Forever client reports itself as mainline and draws the modern map-attached log
instead: no `QuestLogFrame`, no `QuestLog_Update`, no `GetQuestLogTitle`, and rows that come
out of `QuestScrollFrame.titleFramePool` with no names at all. `Compatibility.lua` therefore
replaces `QuestOverlayUI:Update` where that pool exists — feature-detected, not keyed to a
client — walking the pooled rows and hooking `QuestLogQuests_Update`, which is that log's
`QuestLog_Update`. The blank prefix the old log's buttons indent a title with is not available
there: that title wraps into a height the layout has already decided, and a prefix re-wraps it
inside a row too short to hold the extra line. So the button is anchored instead — left of the
title, in the inset the row leaves at its left, and at the other end of the row when "Quest
objectives" is on and the client is drawing its own icon in that inset. The `questPOI` setting
says so (`POIButtonOwnerMixin:GetButtonForQuest` asks it, and a calling quest gets no icon);
failing that, the objective icons find it out: they are pooled beside the rows rather than
parented to them, so the row's own icon is the 20-pixel button carrying the row's quest ID that
is not the play button.

At that end the client ends the title against the quest's type in words (`TagText`, "(Elite)"
on Forever) or else against the storyline icon, whose left edge is the left of the row's icons,
and only then measures the title's height. A hook on the title's `SetPoint` records that end,
whichever form of `SetPoint` the client uses, and moves it 23 pixels left as the client sets it,
when the setting says the client will draw the icon. The title then wraps and is measured with
that room taken, and the button sits in it on the title's line, covering neither the title nor
the type. The row may not hold its quest yet when its title is anchored, so once it does, a
title that disagrees with the row's own icon is moved again to match the button, after the
client measured it. An error in the hook is logged and never reaches the client's quest log.

A quest-log play button has no NPC to ask who is speaking. The dialog names its speaker with
`UnitName("questnpc")` in the client's own language; the log looks the giver up in the pack
(`NPCIDLookupByQuestID` and its object and item twins) and names them from
`NPCNameLookupByNPCID`, which is built from the English corpus. So the addon itself ships every
other language's giver names, `Locale/Names/<lang>.lua`, each returning before it builds
anything on a client in another locale, and `DataModules:GetObjectName` asks them first. They
live in the addon rather than in the packs because the name follows the client, not the voice:
a German client with English packs still shows German names. `make quests-export-giver-names`
writes them from `entity_name` (`tts_cli/giver_names.py`), after an `import-locale`, along with
a `Names.xml` that lists them all. Forever's `.toc` lists each file with
`[AllowLoadTextLocale <lang>]`, as it does the gossip text, so the client loads only its own; the
classic `.toc` files load `Names.xml`. The export stops with the lines to add or remove when
Forever's `.toc` does not list exactly the files it wrote. Only
names that differ from the English are written, since vmangos leaves untranslated names empty;
a giver missing from a file is read in English.

That log's details view gets a button of its own, beside Back, which says `Play` and says
`Stop` while it is reading. The list's buttons cannot follow a quest into it — a frame has one
parent — so it is a single button rebound to whichever quest the panel shows, hung off the same
header strip the Back button is on (a button parented to the details frame itself draws its
artwork under the border art and arrives as a floating label) and mirrored off that button for
its size and its line. `QuestOverlayUI:BindPlayButton` is what both kinds of button share; a
button that says what it does in words rather than in a texture carries a `setPlayState` of its
own, which is what `SetPlayButtonState` calls instead of swapping the icon.

Play is also on each quest in the objective tracker. The Quests page's Show Play Button section
switches the two places apart: Quest Log (`QuestLogPlayButton`, which also takes away the log's
Contribute buttons) and Tracker (`TrackerPlayButton`). Trackers come in three shapes, so
`Compatibility.lua` has one adapter for each, registered with `RegisterTrackerUpdater`.
`QuestOverlayUI.UpdateTrackerButtons` sweeps them all at login, when a pack loads, when Quests is
switched and when the setting changes, and a profile change redraws the quest log and the trackers.
Forever's tracker pools its blocks (`QuestObjectiveTracker`, `CampaignQuestObjectiveTracker`), and
each block keeps one square button at its title's right. Classic Era's tracker writes each title
into a font string named `QuestWatchLineN`. After `QuestWatch_Update`, the adapter matches each
watched quest's title text to a shown line and puts the round button left of it, so a title some
other addon rewrites gets no button. Questie draws its own tracker, and its built-in Play answers
only the retired AI_VoiceOver addon. Each Questie title line gets a separate Spoken button left of
its minimize button, swept after `TrackerUtils:UpdateVoiceOverPlayButtons`, the last call of
Questie's layout. A failing adapter is logged and never raises inside the tracker's own update.
`tests/lua/quest_tracker_adapters_test.lua` covers the Era and Questie adapters.

The web suite runs against a **real Postgres**, because the invariants it protects — archive
the current take before anything overwrites it, never hand the same file to two jobs — live in
schema constraints rather than in code. It reads `DATABASE_URL` from the environment or from
`apps/web/.env.local`, and runs one file at a time, since claiming from a shared queue is global by
definition. `audio.test.ts` is the one that stops a naming change going unnoticed: it asserts
every file in the store is addressed by some corpus line.

## Contributing
If you want to contribute to this project, please feel free to open an issue or submit a pull request.

# CLI Docs

## Dataframe Schema

The dataframe schema before calling the `preprocess_dataframe` function consists of the following columns:

| Column        | Description                                                  |
|---------------|--------------------------------------------------------------|
| `source`      | Indicates the type of interaction, can be 'accept', 'progress', 'complete', or 'gossip' |
| `quest`       | The quest ID or empty string if it's a gossip interaction    |
| `text`        | The text template content of the interaction                           |
| `DisplayRaceID` | The race ID of the NPC involved in the interaction          |
| `DisplaySexID`  | The gender ID of the NPC involved in the interaction        |
| `name`        | The name of the NPC involved in the interaction               |
| `type`        | The type of the NPC involved in the interaction ('creature', 'gameobject', or 'item') |
| `id`          | The creature/gameobject/item ID of the NPC involved in the interaction |
| `ModelID`     | The creature's model where its display has no humanoid race, else empty |

`DisplayRaceID = -1` is used for interactions with inanimate NPCs: gameobjects, items etc. It's mapped to a voice called "narrator" in `RACE_DICT`.

## New Fields Added by `preprocess_dataframe`

The `preprocess_dataframe` function adds the following new fields to the dataframe:

| Column                   | Description                                                  |
|--------------------------|--------------------------------------------------------------|
| `race`                   | The race of the NPC, mapped from `DisplayRaceID` using `RACE_DICT` |
| `gender`                 | The gender of the NPC, mapped from `DisplaySexID` using `GENDER_DICT` |
| `voice_name`             | The voice name, which is a combination of the race and gender fields |
| `templateText_race_gender` | A combination of the text, race, and gender fields          |
| `templateText_race_gender_hash` | A hash of the `templateText_race_gender` field          |
| `cleanedText` | `text` after rendering template |
