# VoiceOver for World of Warcraft

### [voiceline explorer: voiceover.rusty.one](https://voiceover.rusty.one)
### [voiceover discord](https://discord.gg/VdhUmA8ZCt)

## Overview

A pipeline for producing AI voiceovers for WoW Classic dialog. The sound pack and the addon
data module are build outputs of this project.

Every line the project knows about is browsable, playable and — for signed-in collaborators —
re-voiceable at [voiceover.rusty.one](https://voiceover.rusty.one), which is the `web/`
directory of this repo; it is also the only place audio is made.

**Audio is made on the site and nowhere else.** Every take is cut there, archived as a file
of its own that is never changed, and recorded as a row; which take is live is a flag on
that row. This pipeline turns the world database into a corpus and turns the live takes
into a pack:

| Stage | Input | Output | Who runs it |
| --- | --- | --- | --- |
| `extract` | vmangos world DB | `corpus/corpus.json.gz` | a maintainer, when vmangos ships a new dump |
| `make quests-sounds` | live takes + `audio-history/` | `audio/` | before every build |
| `build` | corpus + `audio/` | `dist/SpokenQuestsAudio/` | anyone cutting a release |
| `install` | the built module | WoW AddOns folder | to try it in game |

The corpus is **committed** — 17,507 lines, 2 MB gzipped — so building a pack from a given
`audio/` needs no dump and no Docker.

## Below is for developers only. Go to [releases](https://github.com/mrthinger/wow-voiceover/releases) if youre looking to install the addon.

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
python cli-main.py extract                # writes corpus/corpus.json.gz
```

Commit the resulting corpus; the diff is reviewable.

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

The whole set is listed on `/voices`, which is also the easiest way to build it — see
"Managing voices". The clips to build them from are Blizzard's own NPC greeting barks:

```bash
python tools/fetch_npc_lines.py              # into voice/npc-lines/<race-gender>/<flavor>/
python tools/fetch_npc_lines.py --lang frFR  # the French client's, into voice/npc-lines/frFR/...
```

Every language's clones come from its own client's barks, recorded by its own actors, so a
language other than English has its own set under `voice/npc-lines/<lang>/`, the layout
`/<lang>/voices` seeds from. Wowhead has no Skybourne elves in any language and no blood
elves in Classic, so those come out of the game instead: file ids from the local install's
tables, and each language's recording from Blizzard's CDN, since an install carries only its
own language.

```bash
python tools/fetch_voice_sets.py                   # Skybourne and blood elf, every language
python tools/fetch_voice_sets.py --lang frFR       # just one
```

That directory is gitignored and local-only. It is Blizzard's audio, and it is input to a
pipeline rather than something to redistribute.

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

For a module to hand to players, use `make package-audio` instead: it transcodes first.

```bash
make package                       # the player addon: one Blizzard zip, one per legacy client
make package-audio                 # transcode to ogg, build five packs, zip each -> dist/
make package-audio-complete        # every line in one folder, for the site (~1.3 GB)
make package-meta                  # the "install everything" addon
make package-audio PACKS=all       # only the complete pack, when trying an encode change
make package-audio VERSION=1.4.0   # the version written into each pack's .toc
ENCODE=copy make package-audio     # the masters untouched, to hear what is being given up
```

`make package` takes its version from `## Version:` in `SpokenQuests.toc` and produces four
zips. It refuses to build from an uncommitted tree — `ALLOW_DIRTY=1` overrides while testing —
and refuses when a variant `.toc` or `Environment.lua` names a different version, which is drift
nothing else notices until it ships.

**One zip for Blizzard's clients, one apiece for the private-server ones.** Blizzard's clients
pick a `.toc` by flavor suffix — `_Vanilla`, `_TBC`, `_Wrath`, `_Mainline` — so a single archive
serves Classic Era through retail and the client chooses. The 1.12, 2.4.3 and 3.3.5 clients
predate suffix support: each reads `SpokenQuests.toc` and nothing else, and each wants a
different file under that one name, so each needs an archive of its own. Each also loads its own
vendored Ace3 from `SpokenQuests/<client>/`, because the root `Libs/AceTimer-3.0` binds
`C_Timer.After` while loading and would error there. A legacy zip therefore carries one `.toc`,
one Ace3, and neither of the other two clients' directories.

CurseForge has no game version to file those zips against, so they are published to a GitHub
release: tag `v<version>` and `.github/workflows/release-addons.yaml` checks the tag against
`## Version:`, runs this same script, and attaches all four zips.

The sound packs are the same files on every client. Their `## Interface: 100000` is deliberate,
and `DataModules` sets `checkAddonVersion` to 0 around `LoadAddOn` so a client that considers a
pack out of date loads it anyway.

**The shipping packs are Ogg Vorbis at 44.1 kHz** (`ogg-q0-44k`), which takes 3.2 GB of masters
to about 1.3 GB, split five ways. Vorbis is worth 1.3–1.5× over LAME at these rates and is VBR,
so the bits follow the voice instead of padding silence to a constant rate. A 22.05 kHz
downsample halves that again and speech survives the 11 kHz ceiling it imposes — it shipped as a
second set of packs for a while and is retired, because one format is one set of projects and one
answer to "which do I install".

`make package-audio-complete` builds the same audio as one `SpokenQuestsAudioComplete` folder, ~1.3 GB.
It is **not a CurseForge release**: it is far over the upload ceiling and always will be. The site
hosts it instead — `make push-complete` puts a built zip in `shared/downloads/` on the droplet and
repoints
[`/downloads/SpokenQuestsAudioComplete-latest.zip`](https://spoken.rusty.one/downloads/SpokenQuestsAudioComplete-latest.zip),
a symlink, so the published URL never changes once the pack is renamed. The pre-rename
`VoiceOverReduxAudioHQ-latest.zip` is not kept alive: the descriptions carrying it are being
re-pasted. See `deploy/README.md`.

**The packs ship as five CurseForge projects** — four packs and a meta addon:

| | |
| --- | --- |
| Folders | `SpokenQuestsAudio…` |
| Titles | `Spoken Quests Audio: Alliance` |
| Encode | `ogg-q0-44k`, ~300 MB a pack |
| Built by | `make package-audio` + `package-meta` |

The five projects the retired packs used stay published and are never uploaded to again, so
`MODULE` and `TITLE_FAMILY` in `scripts/quests/package-audio.sh` have one set of packs to name.
The folders were `VoiceOverReduxHQAudio…` until the rename. Renaming them is safe because
nothing stores a path built from a folder name — `DataModules` composes one at play time from
the folder the client reports — but `availableModules` in `DataModules.lua` has to move with
them, since that is how an installed pack is recognised.

`docs/pack-size.md` is where every encode was measured, along with the dead ends (deduplication, silence trimming, harder zip
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

`install` moves any existing install aside to `<module>.replaced` rather than deleting it.

**Icons.** Every addon here carries an `icon.tga` and a `## IconTexture:` line naming
its own folder, which is what the client draws beside the name in the AddOns list; without it
each pack shows a red question mark. The sources are in `assets/icon/`, one pair of SVG and
512 px PNG per mark: `spoken-player.*` is the play triangle the player ships, `spoken-quests.*`
the exclamation mark Spoken Quests and all five sound packs ship. The `.tga` beside each is
committed rather than converted at build time so that building needs no ffmpeg — `make
quests-icon` regenerates both from the PNGs, `tools/make_icon.py` is what it runs, and that
file's header explains why ffmpeg's own targa encoder is not used (it writes RLE, and the
client wants uncompressed).

The minimap button is the same mark again, as `addons/SpokenPlayer/Textures/MinimapButton.blp`
— BLP because a texture a frame loads is BLP on every client this ships to, where the AddOns
list takes either. `tools/make_minimap_icon.py` (also run by `make quests-icon`) crops the
shield's frame off the 512 px render before scaling, since LibDBIcon draws the icon 17 pixels
across inside a round border of its own and two frames at that size read as dirt; the header
explains the crop, the 5% LibDBIcon trims off each edge, and why the BLP is palettized.

### The pack ships in five pieces

600 MB is more than CurseForge accepts in one upload — a 564 MB zip comes back `413` from
Cloudflare before CurseForge ever sees it — and more than a player wants for lines their
character cannot reach. So the store is transcoded once and built into five packs:

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
means "get everything", and no folder is ever owned by two projects. `scripts/package-meta.sh`
builds it and its header explains the rest; `make package-audio PACKS=all` still builds the
single complete folder for local use. The stub deliberately carries no
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

**Which side a quest is on comes from `corpus/factions.json`**, exported by
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
make release-dry          # resolve clients, print every file and note, send nothing
make release              # upload every zip in dist/
./scripts/release.sh audio   # or just one of them
```

`scripts/release.sh` uploads what is **already in `dist/`** — it builds nothing, so the zip
that goes out is the one you tested. Seven projects, one per target: `spoken`
([spoken-player](https://www.curseforge.com/wow/addons/spoken-player), `1700375`), `player`
([spoken-quests](https://www.curseforge.com/wow/addons/spoken-quests), `1655859`), `audio-all`
([spoken-quests-audio-all](https://www.curseforge.com/wow/addons/spoken-quests-audio-all), `1660196`),
and `audio-alliance` / `audio-horde` / `audio-shared` / `audio-gossip`. A target with no id
fails the run rather than uploading a Horde pack over the Alliance project — which is also why
the five retired downsampled projects have no id here at all. It needs
`CURSEFORGE_TOKEN` in the repo root's `.env` — an *author* token from
[authors-old.curseforge.com](https://authors-old.curseforge.com/account/api-tokens), tied to
the account rather than a project, so one covers both.

The player and the packs are versioned independently, and each finds its version somewhere
different for a reason. The player is committed files with a `.toc`, so its version is read
there. A pack has no committed `.toc` at all — `build` generates one — so its version is read
back out of its module in `dist/`, which means releasing a pack nobody built fails instead of
uploading a stale zip that happens to still be lying around. `CHANGELOG.md` holds one section
per version and each target looks up its own.

Files are offered to **Era (1.15.9) and the 2.5.6 Anniversary client** only. The zip carries
`_Wrath` and `_Mainline` TOCs too, but nothing here has been run on those clients, and a file
offered to a client it misbehaves on is worse than one that is simply absent there. Client
names are resolved against `/api/game/versions` and a name matching anything but exactly one
version is fatal, because the alternative failure is a file filed against the wrong client —
which players meet as "the addon does not appear in my list".

Uploading a file cannot change the page around it: descriptions, relations and project
settings live in the web UI, and a script that rewrote them each release would be one that
could quietly undo an edit made there. The complete pack has no project and is not released.

### A language's packs

A language's four packs exist because their pages do: `publishers/quests/audio-<pack>-<lang>.md`
(one per `alliance`/`horde`/`shared`/`gossip`) names the CurseForge project, version, folder and
title that `scripts/lib/packs.mjs` reads instead of a case added to a script per language. `LOCALE=`
moves the whole chain — pull, assemble, build, release — to that language, staged under
`build/quests/<lang>/audio/` rather than English's `pipelines/quests/audio/`:

```bash
make pull-live LOCALE=esMX          # this language's live takes
make sounds LOCALE=esMX             # build/quests/esMX/audio, assembled from the archive
make package-audio LOCALE=esMX      # the four packs, encoded, into dist/
make release-audio LOCALE=esMX      # uploads them, ./scripts/quests/release.sh --lang=esMX
```

The client never says which gossip line is on screen, only who is speaking and the words, and
the addon matches those words against a table to find the line's file. A client in another
locale shows them in its language, so a language's Gossip pack also carries that language's
gossip tables under `generated/<lang>/`, loaded only on a client in it (`tts_cli/locale_text.py`).
They are keyed on `quest_line.localeText` — the line as the world database, and so the client,
has it, not a correction made on the site — and `package-audio` exports it first
(`make export-locale-text LOCALE=esMX`, into `build/quests/esMX/`). Only the Gossip pack
carries them, once per language; the faction packs and every English pack are built as
before. A language with no imported text (`make import-locale LOCALE=esMX`) still builds, with
a warning, and its gossip is matched against the English text.

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

**Progress text is hidden by default.** Those 3,093 lines are 17.7% of the corpus. They were
hidden when nothing voiced them; they are generated like any other line now (migration 0053),
and the default is kept only as a view choice. **Show progress text** brings them back, and `?progress=1` says the same thing in a
URL; absence means hidden, so a bare link is the useful view. Choosing `progress` in the
source filter also counts as asking for them, since otherwise that choice would return
nothing. It is not counted as an active filter: it widens the results rather than narrowing
them, and clearing filters returns it to hidden.

Lines with no audio are marked. `no audio` is a real gap; `invalid-chars` lines are ones the
generator never voices until their text is rewritten.

A translation keeps Blizzard's `$N`, `$C` and `$R` in its stored text, and they are not what
makes it `invalid-chars`: `apps/web/src/lib/player-words.ts` speaks them as the language's
word for "adventurer" and "traveler" (`Abenteurer`, `aventurier`, `путник`, `冒险者`…) wherever
the line is judged or sent — the voiceability gate, the request, and the staleness and dirt
hashes, which go through one function (`sentText`) so they cannot disagree. Case follows the
position, not the token: lowercase mid-sentence, capitalised at a sentence's start and always
in German. A line's female variant, which exists where the English branches on `$G`, gets the
feminine word, and a leftover `$g…;` takes that variant's branch. English quest text has
nothing left for it to replace, its words having been written in at extraction; a book page
in any language, English included, goes through the same table (`docs/books/README.md`). A
token glued to a following letter (`$Nama`) is left in, so the line stays unvoiceable until a
translator rewrites it. Doing this at send time rather than in the rows covers every way a
translation arrives — the dump, the ptBR import, a player's contribution, a translator's edit
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

Respell it as it should be *said*, not as it should be *read*: `nomeregan`, not
`NOME-reh-gan`. Capitals can be spoken as an acronym and hyphens as pauses; if the
stress-capitals form is worth recording for a reader, it belongs in the entry's note.

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

`tools/scan_corpus_hiccups.py` reads the corpus and writes `corpus/hiccups.json.gz`: every
token or fragment likely to trip a reader up — invented names no pronunciation rule covers,
stage directions in asterisks, Blizzard's own typos, raw binary, alphanumeric codes. The
artifact is committed and ships inside a release; `/issues` → **Reload scan** loads it into
Postgres, and it is never read on the search path. `docs/corpus-hiccups.md` documents the
method and the categories.

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
makes an otherwise unvoiceable line voiceable.

**Audio made before a fix says so.** Every take records a hash of the exact string sent to
ElevenLabs, so a line whose text has since changed — by a rewrite, a pronunciation rule or a
corpus refresh — is marked **text changed** and stays playable until someone regenerates it.
Takes from before that hash existed are reported as fresh rather than guessed at.

Like the lexicon, overrides live only in the database, and the Python CLI does not see them.

#### Managing voices

`/voices` is admin-only. It lists every voice on the roster — alphabetically, so a
race-gender's flavors sit together — with the lines and NPCs each one carries, and marks which
exist in the ElevenLabs account. The roster is `apps/web/src/lib/voices/voices.ts`: every
race-gender and its flavors, written down by hand, and read by the triage selects and the
explorer filters too. A voice listed there has a slot before any line uses it, so it can be
cloned before its first line is accepted. The corpus only supplies the counts; a test fails on
a corpus line whose voice is not on the roster, and accepting a contribution refuses one. The
Skybourne elves have the game's two voice sets per gender, named by their NPCSounds id
(`skybourneelf-male-3776`) until they have better names.

Expanding one shows the clips it would be cloned from: upload, play back, delete, and
**merge** a selection into one take with an adjustable pause. A slot finds its own source
material in `voice/npc-lines/<race-gender>/<flavor>/`, which is the shape of its name — no
mapping table to keep in sync when a flavor is added. A slot with no flavor seeds from the files
directly in `<race-gender>/`: `bloodelf-female` is the game's noble blood elf set, the one voice
the roster gives them. `narrator-male` has nothing to seed from, which is expected: it is not a
race.

Merging is there because the practical source is one-second greeting barks.
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

The explorer runs at [voiceover.rusty.one](https://voiceover.rusty.one), on a DigitalOcean
droplet behind nginx. Pushing to `master` builds and ships it automatically — the workflow
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

Deploys are versioned as directories under `/srv/voiceover/releases/`, with `current` a
symlink that pm2 follows, so a rollback is a symlink swap needing neither CI nor network.
The take archive lives outside every release in `shared/`: it is never copied on deploy and
survives a rollback untouched. Migrations run before the swap and are forward-only — a
rollback restores code, never schema, so every release must run against the schema of the
release after it.

A running batch survives a deploy. The new leader picks up whatever it finds in the queue,
and the outgoing one is given 30 seconds to finish its in-flight generations before pm2 kills
it, which is what `kill_timeout` in `deploy/ecosystem.config.js` is for.

First-time droplet setup, the nginx vhost, and the GitHub secrets the workflow needs are in
[`deploy/README.md`](deploy/README.md).

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

### Reporting a line

Two routes, one destination. In the explorer, every row has a flag button that opens the report
form in a dialog — no navigation, and the row already knows which line it is, so the report
carries a `lineId` as well as an address. From the game, the addon's Report button gives the
player an address to open, which lands on `/r/…` and shows the same form.

Both write the same `target` string (`lib/reports/line-target.ts` composes it from a corpus
line, mirroring `formatTarget`), so triage reads one list rather than two. The button is
outside the collaborator gate on purpose: `POST /api/reports` is unauthenticated by design,
because reporting is what a player who cannot sign in has.

### Reports from inside the game

The addon shows a **Report** button in the bottom-right corner of the sound queue frame,
whether or not audio actually played — a silent quest is among the most useful things a player
can tell you. That frame is the only one present for all of it: gossip, quest progress and
completion text, and whatever is playing right now, which is when the complaint tends to occur
to someone. It sits just left of the frame's corner because the resize grabber already owns
that exact spot. Clicking it opens a copy box holding an address, because the client cannot
open a URL or send anything anywhere; the player copies it and opens it in a browser.

The address is built from what the client can see, never from what the data module resolved:
`/r/quest/{questID}/{accept|progress|complete}`, or `/r/npc/{creatureID}` for gossip, for a
client reporting quest id `0`, and as the fallback whenever a quest id is unavailable. That
matters because a data module which failed to load produces no `soundData` at all, and that is
exactly the state most worth hearing about. It also means there is no slug or hash shared
between Lua and Python that could silently drift.

The landing page resolves the address against the corpus, plays the take that is currently
live, and hosts the form. An address that resolves to nothing still renders the form — an
addon sending players to a page the corpus does not know about is itself a bug report.

`POST /api/reports` is the only unauthenticated write in the explorer. It is defended by a
honeypot field answered with `200` rather than `400` (an error only teaches a script to stop
sending the field), a limit of ten reports per hour per IP counted in Postgres so it survives a
pm2 restart, and a category checked against a closed set. The IP is the rate limiter's key and
nothing else: never displayed, never read back. Signing in replaces any typed name.

Collaborators and admins triage at `/reports`, marking each report fixed, not a problem, or
reopening it. **A report never becomes a regeneration job.** Regenerating spends ElevenLabs
credits, so nothing public can start one; someone reads the report, listens, and queues the
file through the normal flow.

### When there is no line at all

A report presumes a line exists and is wrong. Some of the time there is no line to be wrong —
the corpus is built from a 1.12 world database, so it has nothing for content that postdates
vanilla, for a locale that database does not carry, or for whatever a private server invented
on top of it. In those three cases the client in front of the player is holding the only copy
of the text, and `Contribute:HasGap()` puts a button reading **"Contribute"** — the same word
the books addon's button carries — in the top right corner of the Blizzard quest or gossip
frame, just left of its close button, exactly when there is text on screen and nothing queued
to play. The quest log offers the same thing where a quest's Play would be: a small plus icon
in the list, and the details view's Play reading **Contribute**. A contribution from the log
carries the quest's own description as its accept text and `from=log`, but no NPC — the log
does not say who gave the quest. It exists on the Blizzard clients only: the 1.12, 2.4.3 and 3.3.5 clients are private
servers, where contributing is off for now, and their `.toc` files leave out the `Contribute.xml`
that loads it (the 1.12 client's Lua 5.0 could not parse it anyway). A player who does not want it turns it off with **Hide the Contribute buttons** in the
Spoken Player settings, one switch for the quests, books and zones buttons alike; each addon
asks `Spoken:AreContributeButtonsHidden()` in its gap check and refreshes on the player's
`CONTRIBUTE_SETTINGS_CHANGED` callback, since toggling it fires no game event.

Clicking it opens the same copy box `ReportButton.lua` uses, holding a plain-text envelope
instead of an address: the addon, the build, the locale, the quest or NPC, and the text
itself. The client still cannot open a browser or post anywhere, so the player copies it,
opens `spoken.rusty.one/contribute`, pastes, sees a field-by-field preview of exactly what is
about to be sent, and submits.

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
client knows which words those were — so a contributed line is a template like an extracted
one: stored as `originalText`, spoken as `Adventurer`/`Traveler` by the extract's own table,
and hashed on the template when it is gossip. Class and race are swapped wherever they occur as
whole words, so a warrior's "a warrior's discipline" arrives as "a `$c`'s discipline"; that
false positive is accepted over voicing one player's class at everyone. The speaker row is the mark, not the line's origin, because an edit puts an `edited`
version on top; it is also what `corpus_db.py`'s import leaves alone when it replaces every
extracted speaker, and it numbers from 1,000,000 so a re-import never meets it. The corpus
wins where it already has the line: a quest moment is matched by quest id and moment alone
(the tables carry some only as `:m`/`:f` variants), and a gossip line it already has gains the
contributing NPC as one more speaker instead of a copy. Progress lines are voiced like the
rest. Once written, a contribution cannot
be moved back to new or rejected; ignoring the line in the explorer is how to back out.

#### Who is speaking

A line still needs a voice, and a voice name is `race-gender-flavor`. The corpus answers that
for every NPC it carries. For one it has never seen, the answer has to come from somewhere, and
the client can supply two thirds of it.

The addon reports what it can see and nothing more: `kind` (creature or gameobject), `model` —
the model file id a `PlayerModel` frame answers for the unit — `sex` from `UnitSex`, and
`creature` from `UnitCreatureType`. It carries no race table. `apps/web/src/lib/npc/models.ts`
holds that instead, 81 character models across 32 races, and maps `122055` to
`{race: "tauren", gender: "male"}`. The path a race and gender resolve to on disk —
`character/tauren/male/taurenmale.m2` — lives in the community listfile, not in this repo; the
model table only ever needs the race and the gender an id names, never the path itself. The
table lives on the site deliberately: a race added upstream, or an id that turns out to mean
something else, is corrected in one deploy, while a table shipped inside the addon waits for
every player to take an update, and the legacy-client players install their zips by hand.

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

**The flavor cannot be detected in game, and it is worth knowing why before going looking.**
`tts_cli/flavors.py` recovers it by reading SoundEntries names like
`DwarfFemaleMaternalNPCGreetings`. No client API exposes a creature's `NPCSoundID`, nor the
sound the game chose to play when the gossip frame opened, and the modern client's data has no
`SoundKitName` table at all. So for a new NPC the flavor is defaulted and flagged, and a
moderator is the only thing that can improve it.

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

The answer is stored once per NPC, keyed on the kind *and* the id for that same reason, so one
correction fixes every line that NPC speaks. `npc_resolution` also keeps what the client
reported even when a moderator overrules it — evidence about the NPC is worth more than the
guess it produced — along with the client build, since model ids are per-build data.

Precedence is enforced in the SQL rather than by whoever calls it: `moderator` outranks
`corpus`, which outranks `client`, which outranks `none`, and a write only lands when it ranks
at least as high as what is already there. A submission carrying less information can never
erase one carrying more — the case that matters is a player on an older addon, whose envelope
has no model at all, submitting for an NPC somebody else already resolved.

`/contributions` shows the result with its provenance and says plainly which rows are guesses;
the override there writes `moderator` and is collaborator-only, like everything else that
changes a row. A new race or voice set is added to the roster in
`apps/web/src/lib/voices/voices.ts`: that puts it in the triage selects and gives it a slot on
`/voices`, marked as not existing in the account until it is cloned.

`/contributions/game-data`, unlinked and collaborator-only, resolves NPCs from a game client
instead of by hand. It lists chat commands that make the client ask its server about every
unresolved NPC. The answers land in the client's `creaturecache.wdb`, which the page reads in
the browser for each NPC's appearance ids. The server turns those into voices with
`apps/web/src/lib/npc/display-voices.json`, and **Apply** writes them as moderator answers.
The voice set decides over the model, because it is what the player hears.
`display-voices.json` comes from a local install, so regenerate it when the client updates:

```bash
curl -sL https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv -o /tmp/listfile.csv
python tools/export_display_voices.py --listfile /tmp/listfile.csv
```

## Addon Install

```bash
python cli-main.py install --force        # dist/<module> -> the AddOns folder
```

`install` targets `_classic_era_` by default (`--addons` for another path) and moves any
existing install aside to `<module>.replaced` rather than deleting it. The addon itself is a
separate folder in the same AddOns directory; symlink both for faster development:

```bash
export WOW_DIR=PATH_OF_YOUR_WOW_DIR
ln -s "$PWD/SpokenQuests" "$WOW_DIR/_classic_era_/Interface/AddOns/SpokenQuests"
ln -s "$PWD/dist/SpokenQuestsAudio" "$WOW_DIR/_classic_era_/Interface/AddOns/SpokenQuestsAudio"
```

Use `SpokenQuests/` on a current client. Upstream `AI_VoiceOver/` calls
`GetNumAddOns`, `GetAddOnMetadata` and `LoadAddOn`, which Blizzard moved to `C_AddOns` in
10.2 and removed in 11.0.2, so on Classic Era 1.15.9 it errors while enumerating and the
sound pack never registers. Install one player, never two — two copies fight over the same
`VoiceOverDB` and the same sound queue. `SUPERSEDED_PLAYERS` at the top of `VoiceOver.lua`
pairs every name this lineage has run under with the folder it installs into — upstream's
`AI_VoiceOver`, this project's own `AI_VoiceOver_Continued` and `VoiceOverRedux`, since a
rename uninstalls nothing — and each one found is stopped by AceAddon name for the session
and disabled by folder for the next login.

**A player counts as a duplicate when it has registered, not when its folder is present.**
The folder proves nothing: the tombstone this release ships under `VoiceOverRedux` holds one
`.toc` and no code, and it arrives inside this addon's own zip, so a fresh install opened
with a dialog about
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
`SpokenQuestsAudio` since 2.0.0. An old pack still works —
the player finds packs by the `X-SpokenQuests-DataModule-Version` key in the TOC, or the inherited `X-VoiceOver-DataModule-Version` that every shipped pack carries, not by name
(`DataModules:EnumerateAddons`) — but settings do not survive, because `SavedVariables` live in
`WTF/…/SavedVariables/<folder>.lua` and the folder is the identity.

**The pack is nested under the player in the AddOns list** by `## Group: SpokenQuests` in
both TOCs — the value is the main addon's *name*, so it is the folder rather than the title.
That tag arrived in 11.1.0; the `X-Part-Of` and `X-Child-Of` lines beside it are custom `X-`
fields the client never reads, kept because addon managers do and because upstream shipped
them.

The data module names no `RequiredDeps`. It used to require `AI_VoiceOver`, which made
`LoadAddOn` fail with `DEP_DISABLED` whenever the player was a fork under another folder name
and the original sat disabled — three folder names into this lineage, that is the normal case. The module is `LoadOnDemand` and its `Module.lua` returns early
unless `VoiceOver.DataModules` exists, so the dependency bought nothing and cost the fork.
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
never read at all. The quest globals are therefore snapshotted when the client fires the event,
which is the last moment they still describe it, and the watcher replays that snapshot when the
quest ID drops to 0 with nothing dispatched for the dialog. It is a fallback, not a second
dispatcher: a dialog the player clicks through is dispatched by the watcher as before and its
snapshot is discarded.

`tests/lua/quest_overlay_test.lua` covers the other thing the quest UI owes a player: the play
button beside each quest in the quest log. There are two quest logs to draw it in. The old one
is a named frame with numbered title rows (`QuestLogTitle1`…), redrawn through `QuestLog_Update`
— what Classic Era and the private-server clients have, and what `QuestOverlayUI` was written
against. The Forever client reports itself as mainline and draws the modern map-attached log
instead: no `QuestLogFrame`, no `QuestLog_Update`, no `GetQuestLogTitle`, and rows that come
out of `QuestScrollFrame.titleFramePool` with no names at all. `Compatibility.lua` therefore
replaces `QuestOverlayUI:Update` where that pool exists — feature-detected, not keyed to a
client — walking the pooled rows and hooking `QuestLogQuests_Update`, which is that log's
`QuestLog_Update`. The blank prefix the old log's buttons indent a title with is not available
there: that title wraps into a height the layout has already decided, and a prefix re-wraps it
inside a row too short to hold the extra line. So the button is anchored instead — left of the
title, in the inset the row leaves at its left, and beside the tracking checkbox at the other
end of the row when "Quest objectives" is on and the client is drawing its own icon in that
inset. The objective icons are how that is detected: they are pooled beside the rows rather
than parented to them, so the row's own icon is the 20-pixel button carrying the row's quest ID
that is not the play button.

That log's details view gets a button of its own, beside Back, which says `Play` and says
`Stop` while it is reading. The list's buttons cannot follow a quest into it — a frame has one
parent — so it is a single button rebound to whichever quest the panel shows, hung off the same
header strip the Back button is on (a button parented to the details frame itself draws its
artwork under the border art and arrives as a floating label) and mirrored off that button for
its size and its line. `QuestOverlayUI:BindPlayButton` is what both kinds of button share; a
button that says what it does in words rather than in a texture carries a `setPlayState` of its
own, which is what `SetPlayButtonState` calls instead of swapping the icon.

The web suite runs against a **real Postgres**, because the invariants it protects — archive
the current take before anything overwrites it, never hand the same file to two jobs — live in
schema constraints rather than in code. It reads `DATABASE_URL` from the environment or from
`web/.env.local`, and runs one file at a time, since claiming from a shared queue is global by
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
