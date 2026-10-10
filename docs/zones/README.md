# ZoneLore

A World of Warcraft **Classic Era** addon that shows zone lore on the world map,
with lore text built from warcraft.wiki.gg at development time.

Target clients: **Classic Era 1.15.9** and the **Anniversary client, 2.5.6**
(`## Interface: 11509, 20506`). Not built for retail. The lore covers vanilla
Azeroth on both; Outland and the blood elf and draenei starting zones have none
yet, so the panel is simply empty there.

This repository holds three things: the addon, the sound packs it plays, and the
tooling that produces both.

## What ships

**`ZoneLore`** — the addon. World map side panel, subzone lore on click, the area under the
cursor lit up as clickable, standalone lore window, minimap button, options panel, narration
playback with floating controls, and autoplay on area discovery. 49 zones and
1304 subzones of text are bundled; nothing is fetched at runtime.

**Sound packs** — 1353 voicelines, built from the same text, shipped separately
because they are a large download. Two tiers with identical content:

| Folder | Bitrate | Zip |
|---|---|---|
| `SpokenZonesAudio` | 128 kbps (the masters) | ~790 MB |
| `ZoneLoreAudio64` | 64 kbps mono | ~400 MB — **retired** |

`ZoneLoreAudio64` is no longer built or uploaded: one quality is one project, one
folder and one answer to "which do I install". It stays published for anyone who
has it. Both can still be installed at once — Spoken Zones plays the
higher-bitrate one and `/spz audio` switches; see "Sound packs are
self-describing" below for how it decides.

Player-facing documentation lives in `addons/Spoken_Zones/README.md` and
`addons/SpokenZonesAudio/README.md` — those are the CurseForge project descriptions.
Release history is in `CHANGELOG.md`.

## What is here but not shipped

**`web/`** — the voiceline explorer, for listening through takes and
regenerating the bad ones. Backed by Postgres. Deployed to lore.rusty.one via
`deploy/`; it is a working tool, not a public one.

**`pipelines/zones/tools/`** — the wiki scraper, the ElevenLabs generation pipeline, and the
validators that keep the generated Lua honest.

## Layout

```
addons/Spoken_Zones/          the addon itself (this is what WoW loads)
  ZoneLore.toc
  embeds.xml             loads the bundled libraries
  Language.lua           which language is read, and the string lookup
  Core.lua               namespace, saved variables, events, zone/subzone lookup
  Audio.lua              narration playback state
  Autoplay.lua           narrate an area when the game announces its discovery
  Locale/enUS.lua        every interface string, and the key set for translations
  Locale/<locale>.lua    a translation of those strings; empty so far
  Data/Languages.lua     GENERATED -- what each language covers, and if it ships
  Data/enUS/Zones.lua    GENERATED -- do not edit by hand
  Data/enUS/Subzones.lua GENERATED -- do not edit by hand
  Data/<locale>/Aliases.lua  GENERATED -- localized area name -> English key
  UI/TextView.lua        shared scrolling wrapped-text widget
  UI/AudioButton.lua     the Play/Stop button shown on a description
  UI/MapPanel.lua        the world map side panel
  UI/SubzoneClick.lua    resolves a map click to a subzone
  UI/MapHighlight.lua    lights up the area under the cursor on a zone map
  UI/LoreWindow.lua      standalone browsable lore window
  UI/MinimapButton.lua   LibDBIcon minimap button
  UI/PlaybackBar.lua     floating controls, shown only while narrating
  UI/Options.lua         settings panel
  Libs/                  LibStub, CallbackHandler-1.0, LibDataBroker-1.1,
                         LibDBIcon-1.0 (copied from AI_VoiceOver_Continued)
  README.md              player-facing docs; the CurseForge description
addons/SpokenZonesAudio/     the sound pack, at master (128kbps) quality
  SpokenZonesAudio.toc      rewritten per tier at packaging time
  Data/Sounds.lua        GENERATED -- the clip lookup table
  Sounds/                GENERATED, gitignored -- the mp3s themselves
  README.md              player-facing docs; the CurseForge description
pipelines/zones/tools/
  lib/wiki.mjs           shared fetching, era filter, Lua emission
  lib/sections.mjs       which article headings count as lore
  lib/loredata.mjs       reads the generated Lua data back into JS
  lib/env.mjs            binds pipelines/lib/env.mjs to this pipeline: the root .env,
                         then pipelines/zones/.env over it
  voice/generate.mjs     report on voicelines: missing, stale, cost (makes no audio)
  voice/build-lookup.mjs manifest -> ZoneLoreAudio/Data/Sounds.lua
  voice/validate-audio.mjs  manifest, files and lookup table agree
  voice/naming.mjs       line ids and file paths, derived in one place
  voice/normalise.mjs    display text -> spoken text
  voice/config.json      voice, model, output format
  voice/manifest.json    what has been generated, when, from what text
  scrape.mjs             warcraft.wiki.gg -> Data/Zones.lua
  scrape-subzones.mjs    warcraft.wiki.gg -> Data/Subzones.lua
  rewrite-lore.mjs       full articles -> lore prose, via Claude (costs credits)
  validate.mjs           checks the generated Lua without a Lua interpreter
  lua-syntax-check.py    block-balance check for the addon's Lua
  seed-from-dump.mjs     compares the seed against a live client map dump
  seed/zones.json        uiMapID -> wiki page title
  seed/subzones.json     which parent zones to scrape subzones for
  seed/overrides.json    hand-written zone lore that beats the scraped text
  seed/area-names.json   every corpus place's name per client language, from AreaTable
  seed/zone-regions.json each zone map's world rectangle and explored-area overlays
  fetch-zone-regions.mjs client map tables -> seed/zone-regions.json
  lib/zone-at.mjs        the zone a world point stands in, for the explorers' zone filter
  lore/import.mjs        seed the lore_line table from the committed Lua
  lore/export.mjs        write the addon's Lua data files from lore_line
  lore/import-names.mjs  seed/area-names.json -> entity_name, the site's place names
  lore/rewrite.mjs       the rewrite prompt, its response cache and its checks
  lore/store.mjs         the seam between the lore table and the Lua files
  lib/locales.mjs        the languages, and the pack folder each ships in
  lib/db2.mjs            client database tables from wago.tools, per locale
  locale/build-aliases.mjs   AreaTable -> Data/<locale>/Aliases.lua and seed/area-names.json
  locale/build-languages.mjs coverage -> Data/Languages.lua, the readiness gate
  locale/check-strings.mjs   per-language interface string coverage
scripts/zones/deploy.sh        install both addons into the Classic Era AddOns folder
scripts/zones/package.sh       build the ZoneLore zip
scripts/zones/package-audio.sh build the sound pack zips, one per quality tier
CHANGELOG.md             release notes; the text pasted into CurseForge
```

## Installing for development

```sh
./scripts/zones/deploy.sh            # symlink; edits are live, just /reload in-game
./scripts/zones/deploy.sh --status
./scripts/zones/deploy.sh --remove
```

Symlinking means no redeploy per edit. If the client's AddOns list does not show
ZoneLore, use `./scripts/zones/deploy.sh --copy` and re-run it after each change.
SavedVariables live under `WTF/`, so neither mode can lose your settings.

## Regenerating the lore data

```sh
node tools/scrape.mjs              # uses tools/cache/ where present
node tools/scrape.mjs --refresh    # re-fetch every page
node tools/scrape.mjs --only 1411 --verbose   # tune one zone, show filtering
node tools/validate.mjs            # check the generated Lua
```

The scraper needs Node 18+ and has no dependencies (`pipelines/zones/tools/voice/` does: `pg`, for
the explorer's database — see "The voiceline explorer"). It caches every raw API
response under `pipelines/zones/tools/cache/` (gitignored) so iterating on text cleanup never
re-hits the wiki, and throttles to one request per 500ms with an identifying
User-Agent.

### Source: prefer the wiki's Classic-specific pages

warcraft.wiki.gg keeps **separate `<Name> (Classic)` articles** for places whose
description changed after vanilla. These are written about the 1.x world rather
than filtered down from an all-expansions article, so they are era-correct at the
source:

| | general page | `(Classic)` page |
|---|---|---|
| Durotar | "borders the **Northern** Barrens" (Cata split) | "borders **the Barrens**" |
| Darkshore | Auberdine absent (Cataclysm destroyed it) | "the port of **Auberdine**" |

**39 of the 46 zone maps** have one; the exceptions are Moonglade and the six
capital cities, which fall back to the general page. For subzones only a couple
have a `(Classic)` variant, so most still come from the general page.

`fetchClassicTitleIndex` builds the lookup from `Category:Classic zones` and
`Category:Classic subzones` in two requests, and `classicVariant` handles the
wiki dropping a leading article ("The Barrens" → "Barrens (Classic)"). The
`(Classic)` suffix never reaches the addon — display names and lookup keys are
always derived from the bare title. Pass `--no-classic` to ignore these pages.

The era filter still runs over Classic pages as a safety net, and still earns its
keep on a handful (Blasted Lands, Loch Modan, Eastern Plaguelands, Silithus).

Two alternatives were checked and rejected: `Category:Classic subzones` (83 pages)
is only a tag over pages already fetched — Auberdine is in
`Category:Darkshore subzones` already, so there was no coverage gap — and the
wiki's revision history reaches back to 2004, so a pre-Cataclysm-2010 revision was
viable, but it needs raw wikitext parsing and would still contain TBC and WotLK
content.

### Thin leads fall back to article sections

Some pages lead with one sentence and keep the description under a heading:
`Elwynn Forest (Classic)` opens with "Elwynn Forest is the starting zone for
playable humans." and puts the real text under `== Geography ==`, which
`exintro` skips. When a lead comes in under the threshold (300 chars for zones,
200 for subzones), `fetchLoreText` re-fetches the full article and takes the
lore-bearing sections — Geography, Description, History, Lore, Overview — capped
on a paragraph boundary. Elwynn went 55 → 804 chars. Quest tables, NPC lists and
"Patch changes" are never included.

### The era filter

Wiki zone intros narrate a zone across *every* expansion, so an unfiltered scrape
would tell a Classic Era player about Deathwing and Pandaria. `scrape.mjs` drops
any **sentence** containing a post-vanilla marker.

Sentence granularity matters: several intros are a single paragraph of otherwise
timeless description with one clause about a later expansion. Filtering by
paragraph either loses good vanilla lore or keeps the anachronism.

Terms deliberately *not* treated as post-vanilla, because vanilla lore uses them
legitimately: Draenor, Burning Legion, Northrend, Lich King, Scourge, Naxxramas,
the Third War, the Dark Portal, and lower-case "dragonflight" (the black/blue/
bronze/green flights all appear in vanilla zone text).

`cataclysm` *is* matched case-insensitively, because the wiki writes "until the
cataclysm, the huge lake from which the region takes its name" about Loch Modan —
and in Classic Era that lake is still full. A rare false positive on a Sundering
reference is cheaper than wrong-era geography; use `overrides.json` if one shows up.

`pipelines/zones/tools/validate.mjs` re-checks the generated file for leaks, so a filter
regression fails loudly rather than shipping.

## Rewriting the lore: selection was never going to be enough

The scrapers can only *choose* text, and choosing was not the problem. A wiki
article is written for someone reading a website: it mentions quests, professions
and patch numbers, it narrates every expansion at once, and its facts arrive in
encyclopedic order rather than as a story. Reading only the lead avoided most of
that, at the cost of the `== History ==` section — which is where the pre-WoW lore
lives, and which 169 of 224 cached articles keep below the fold.

So there is a second pipeline. `pipelines/zones/tools/rewrite-lore.mjs` reads the **whole**
article, keeps the lore-bearing sections, and has Claude write them back as one to
three paragraphs of in-world prose.

```sh
make zones-lore-rewrite ZONE=1420                         # dry run, both variants, report only
node tools/rewrite-lore.mjs --zone 1420 --variant a # write one zone to the corpus
node tools/rewrite-lore.mjs --all --variant a       # the whole corpus
```

**This spends Claude credits, which is why it is not part of `make zones-scrape`.** A
scrape is a thing you run without thinking about it; a paid rewrite of 1353 lines
is not. `--dry-run` writes only a markdown report to `dist/`, and every response is
cached under `pipelines/zones/tools/cache/rewrite/` keyed by model, prompt version and source text —
so re-running an unchanged zone is free, and iterating on the prompt only pays for
what actually changed.

### Section selection is deterministic; only the prose is not

`pipelines/zones/tools/lib/sections.mjs` decides what the model may see, by heading: History,
Background, Description, Overview, Geography. Everything else — NPC and mob lists,
quests, loot, travel connections, Notes, Trivia, Speculation, "Patch changes" —
never reaches the prompt. `In the RPG` is dropped twice over, by heading and by the
banner sentence the wiki opens it with, because it is explicitly non-canon.

Banner templates are stripped too. `explaintext` renders them as ordinary
sentences in the middle of good prose — "This section concerns content related to
Warcraft III", "From the World Dungeons page on the official World of Warcraft
Community Site:" — so they survive both the heading filter and the era filter, and
read to a model as facts about the world rather than furniture from a website.

The era filter then runs over the assembled text, before the model sees it. A
Cataclysm sentence that never reaches the prompt cannot survive the rewrite.

### The length budget follows the article, not a global cap

One limit for every place was the wrong instrument. Told only "under 1000
characters", the model wrote to the limit whatever it was given: a 342-character
stub about Nightmare Vale came back as 790 characters, and the difference was
atmosphere it had invented, because three facts do not fill three paragraphs.

Each line now gets a budget computed from its own source — roughly the length of
the material below the cap, a hard 1000 above it, floor 250. Thin articles stay
thin; the 19,000-character Tirisfal article gets the ceiling and the prompt's
choosing rule decides what survives. Across Tirisfal this was the difference
between 1.38x and 1.07x the previous corpus size, which is five hours of narration
and 240 MB of sound pack.

### What the checks catch, and what they deliberately allow

Nothing throws. A bad rewrite is a line in the report, not a reason to abandon the
other forty-five, and a flagged line is simply not written to the corpus.

- **over budget** — retried once or twice with the real character count, which the
  model cannot know in advance but cuts accurately when told
- **post-vanilla lore** — the same `isPostVanilla` the scrapers use
- **invented names** — capitalised words in the output that appear in no source

That last check distinguishes two things it would be easy to conflate. A name
missing from *this* article but present in a neighbour's is regional vocabulary:
calling the undead of Tirisfal "the Forsaken" is a fair inference from an article
that describes them without the word, and it is reported as inference rather than
flagged. A name that appears in **no** article in the run is the failure worth
stopping for — an early run set Venomweb Vale "deep within the Alterac Mountains",
which is nowhere near it, because that variant's source never said where the vale
was.

### Rewritten lines are a distinct origin, so a scrape cannot undo them

`lore_line.origin` gained `scraped-rewritten` in migration 0006. `recordScrape`
promotes only over `scraped`, so re-running `node tools/scrape.mjs` leaves
rewritten text alone; `recordRewrite` promotes over `scraped` and over an earlier
rewrite, and is held back behind a hand edit exactly as a scrape is. The text is
still derived from the wiki article and keeps its `source` and its CC BY-SA
attribution.

## Subzones

Click a subzone on a zone map and the panel swaps to that subzone's lore, with a
"< Back to \<Zone\>" link. Covers **1304 subzones across all 46 zone maps**.

```sh
node tools/scrape-subzones.mjs              # all zones in the seed
node tools/scrape-subzones.mjs --list 1420  # just list the wiki category
node tools/scrape-subzones.mjs --zone 1420 --verbose
```

Counts range from Ashenvale's 59 down to Alterac Mountains' 5. A full run is about
1300 pages, roughly 11 minutes at the 500ms throttle; with a warm
`pipelines/zones/tools/cache/` it is under a minute.

Azeroth (947), Kalimdor (1414) and Eastern Kingdoms (1415) are deliberately
excluded: they are not Zone-type maps, so a click on them is Blizzard's own
navigation and `UI/SubzoneClick.lua` ignores them. 44 of the 46 resolve their
category from the zone name; The Barrens and The Hinterlands need a `category`
override because the wiki drops the leading article. For the Barrens the vanilla
`Barrens subzones` category is correct, not the Cataclysm-split
`Northern Barrens subzones`.

Category queries are pinned to `cmnamespace=0`: `cmtype=page` alone lets through
project and talk pages that have been miscategorised on the wiki, which is how
`Warcraft Wiki talk:Village pump/Archive11` first turned up as a Hillsbrad
subzone.

`Data/Subzones.lua` is about 1 MB. That is well within what addons ship
(`AI_VoiceOverData_Vanilla` in the same AddOns folder is 3.1 MB), but if load time
becomes a concern the file is a candidate for splitting per zone behind
`## LoadOnDemand`.

### Why subzone lore is keyed by name

Subzones are **areas, not uiMapIDs** — `C_Map.GetMapInfoAtPosition` cannot see
them, because it only returns child *maps*. The API that resolves a cursor
position to a subzone is `MapUtil.FindBestAreaNameAtMouse`, and it returns a
**name string, not an ID**. So `Data/Subzones.lua` is keyed by parent uiMapID and
then by a canonical form of the name.

That canonical form matters because the client and wiki disagree cosmetically:
the wiki titles a page **"Bulwark"** while the client reports **"The Bulwark"**.
`normaliseKey` (JS) and `ZoneLore:NormaliseAreaKey` (Lua) both lower-case, drop a
leading "the", strip apostrophes and collapse punctuation to single spaces, so
both sides meet at `bulwark`. `pipelines/zones/tools/validate.mjs` asserts the two
implementations stay in step and that every generated key is already canonical —
a non-canonical key would be silently unreachable.

If a client name still misses, `pipelines/zones/tools/seed/subzones.json` has an `aliases` section
mapping a client-reported name to a wiki page title. Use `/spz debug` in-game to
see the raw name.

### Post-vanilla subzones are kept on purpose

Silverpine's category includes Cataclysm-era places like Forsaken High Command and
the Gilneas Liberation Front Base Camp, and the text filter does not reliably
catch them. They are left in: lookup is driven by what the client reports, and the
Era client never reports an area that does not exist in 1.15.9, so those rows are
inert and cost only file size. What matters is that areas which *do* exist carry
no post-vanilla text, which the sentence filter handles.

### Two axes: the client's locale and the language being read

> **The pipeline and the site no longer have a language axis.** The lore is English,
> `generate.mjs` and the exporters take no language, the translation sheet round-trip
> is gone, and the site serves one corpus with no switcher. Adding languages back is a
> decision to take for all three addons at once rather than for this one alone.
>
> **The addon keeps everything it had.** `Data/<locale>/Aliases.lua`, `Data/Languages.lua`,
> `Locale/<code>.lua` and `Language.lua` are untouched, and `make zones-aliases`,
> `make zones-languages` and `make zones-locale-check` still maintain them. The two
> sections below describe the halves that were removed, and are kept for when they
> come back.

These are separate, and conflating them is the failure that reads as "the addon
just does not work in German".

The **client locale** is `GetLocale()`. It decides what `GetSubZoneText` and
`MapUtil.FindBestAreaNameAtMouse` hand back, and therefore which alias table has
to turn those names into corpus keys. The **content language** is what the player
chose to read and hear; it decides which lore table, which interface strings and
which sound pack are used. A German client reading English lore needs German
aliases — the lookup happens on the client's terms whatever language the words
are in.

The corpus is keyed by the **English** name in every language, because a place is
one place whatever it is called. `Data/<locale>/Aliases.lua` maps the localized
name a client reports back to that key, generated by `make zones-aliases` from the
client's own `AreaTable` at the build pinned in `pipelines/zones/tools/lib/db2.mjs` — the same
table `fetch-era-areas.mjs` already reads, requested once per locale and joined
on the row ID.

Those tables are keyed by the **raw** client name, not a normalised one.
`NormaliseAreaKey` reduces a name to `[a-z0-9 ]` to reconcile the wiki's
punctuation with the client's, which leaves exactly nothing of `Дун Морог`. Both
sides of the alias come from `AreaTable`, so an exact string match is available
and is the most precise thing on offer.

Coverage is not uniform, and the gaps are not failures. Around one subzone in
eight is called the same thing in German as in English and needs no alias; the
client normalises its way there. Italian Classic has no localized area names at
all, so its table is empty and correct. Russian, Korean and Chinese are at or
near 100%, which they have to be — for those clients, normalisation is not a
fallback.

### A language is hidden until its lore is finished

`Data/Languages.lua` is generated by `make zones-languages` and records, per language,
how much of the lore and how many interface strings exist and whether an alias
table is present. `ready` is lore complete plus an alias table; interface strings
are counted but not required, since they fall back to English per key and an
English options panel over a German corpus is worth shipping. The switcher only
offers languages that are ready **and** whose script the client can draw — `UI/TextView.lua` takes
its font from `GameFontHighlight`, which is the client's font, so Chinese lore on
a German client is a screen of boxes.

A player who never chose reads their client's language the day it becomes ready;
one who picked English keeps English. That is why the stored preference is absent
rather than `"enUS"` by default — the two are different answers.

`/spz lang <code> force` previews an unfinished language and warns on every login
while it is set. It is not in the options panel: a player who finds it by accident
is a player reading half-English screens and reporting it as a bug.

Switching takes effect on `/reload`. Each language's data file is guarded by
`ZoneLore:ShouldLoadLanguage`, so the tables for a language that was not active at
load were never built; faking a live switch would show half-empty panels. Every
language's file is still *parsed* at login even when guarded — that is
unavoidable inside one addon — so if the parse cost ever becomes measurable, each
`Data/<code>/` moves into its own `## LoadOnDemand` folder inside the same zip.
`RegisterLoreData` exists as the seam for exactly that, which is why the data
files call it instead of assigning the globals.

**There is no per-line English fallback.** A place with no lore in the language being
read shows nothing, exactly as a zone with no lore at all does — the panel is empty
rather than wrong, which is the same rule Outland already follows. Falling back would
put English prose under a translated heading, which reads as a translation done badly
rather than one not done yet, and the readiness gate means a language on offer has no
holes to fall through anyway.

Interface strings are the exception and do fall back to English. A missing string is an
unlabelled button, and an English label beats an empty one; a missing line of lore has
an honest empty state that prose from another language does not improve on.

### Translations arrive as a spreadsheet

> Removed. `make zones-lore-sheet`, `-lore-upload` and `-lore-upload-dry` and the two tools behind them are gone.

Nothing here translates. A language's lore is written by people, either one line at a
time in the explorer's edit dialog under that language, or in bulk through a sheet:

```sh
make zones-lore-sheet LOCALE=deDE                          # dist/lore-deDE.csv, English beside the blanks
make zones-lore-upload-dry LOCALE=deDE FILE=dist/lore-deDE.csv   # what recording it would do
make zones-lore-upload LOCALE=deDE FILE=dist/lore-deDE.csv       # record it
make zones-lore-export LOCALE=deDE && make languages       # into the addon; readiness recount
```

The sheet lists every line the Era client can report — `lineId`, where it is, the
place's name as that language's client shows it, and the English text — and two
columns to fill: `full` (blank means not translated, skipped) and an optional `short`. Whatever is already translated comes
back filled in, so the sheet is also the review copy, and re-uploading it unchanged
records nothing.

`recordTranslations` in `pipelines/zones/tools/lore/store.mjs` follows the scraper's rules: a new or
changed text is a new `translated` version of the line in that language; a line
somebody has since hand-edited in the explorer keeps the edit, and the upload lands
underneath it as a kept, non-live version. So a stale sheet can never overwrite a
correction, and the upload is safe to repeat. Structure and the wiki `source` come
from the English row — a translation is a derivative of that text and carries its
attribution — and it never adds or removes a line.

**Place names are never translated here.** The client already names every zone and
subzone in its own language, and `make zones-aliases` writes those names out of `AreaTable`
straight into each locale's `addons/Spoken_Zones/Data/<locale>/Aliases.lua`
(`pipelines/zones/tools/locale/build-aliases.mjs` does it, fetching the table per run
rather than through a committed seed). The explorer names places from that table in whatever language is being
read, translated line or not; a translated row is stored under the same name, so an
exported `Subzones.lua` lists places as the client does. A place whose name the client
leaves in English — Italian Classic, or a name that is the same in both — reads in
English, which is what that client shows on its map.

### The explorer's language switch is in the header

> Removed. The site serves English and has no switcher; the language is not in the path.

The corpus is edited in the explorer, so translating is something it has to be able to
do — and the language decides more than which rows are listed. It decides which text is
edited, which narration plays, which voice a regeneration spends credits on, and which
language a report is about. So the switch sits in the site header, beside the account
controls, rather than among the search filters: a filter narrows a set of lines, and a
control in the filter bar would also vanish on every page that has no filter bar.

**The language is in the path**, not a cookie or a query parameter: `/deDE`,
`/enUS/feedback`, `/esMX/r/1411/razor-hill`. The language decides what the page says, so
it belongs in the page's address — a pasted link shows the recipient what it showed the
sender, the back button walks through language changes like any other navigation, and
switching is a plain client-side navigation that applies immediately. An earlier version
kept it in a cookie and the explorer went on showing the old language until something
happened to refetch, which read as a switch that did nothing.

Pages that mean the same thing in every language stay outside the segment — settings,
the user table, sign-in — and the switch hides itself there rather than offering a change
with nowhere to apply it. A `/deDE/admin` rendering exactly `/enUS/admin` would be two
addresses for one page.

The bare paths still work and redirect to English: `/`, `/feedback`, `/voice` and
`/r/{mapID}/{slug}` are what every existing link says — shared URLs, bookmarks, and the
addon's Report button, which builds the language-free form today. All of them meant
English when they were written. An unknown code like `/xxYY/feedback` is a 404 rather
than a redirect, because it is not a page with a bad setting, it is not a page.

`useLang` derives the language from the first path segment rather than taking it as a
prop: the root layout sits above the `[lang]` segment and cannot see the parameter, and
reading it there keeps that layout static. It reads the query string at click time rather
than through `useSearchParams`, which would opt every component in the header into
client-side rendering and demand a Suspense boundary on every page.

Every language is listed, including the ones nothing has been written in: choosing an
empty one is how a translation starts. What is *finished* is the addon's question, not
this one — the explorer is the workbench.

**An untranslated line is empty, not English.** The row says "not translated" and the
edit dialog puts the English above the box as read-only source. Falling back would make
a language look further along than it is, and every number derived from the text would
describe English: the character count, the regeneration quote, the missing/stale/current
state. Worse, a batch would narrate English prose with a German voice and record it as a
German take.

**The first translation of a line is an insert, not an edit.** `saveLore` copies the
structural fields — uiMapID, kind, key, and the wiki `source` with its CC BY-SA
attribution — from the English row when the language has none of its own. Which
languages a line exists in is not a property of the place, and a translator should not
have to seed a row before writing one. `expectedVersion` is skipped for that first save:
there is no earlier version in that language to conflict with, and comparing against
English's number would reject every one.

**Nothing is scoped by assumption.** Every `lore_line` and `voiceline_take` query names
its language in SQL. Unscoped, an English save would clear the German row's live flag
and insert its replacement as English — the German line would simply stop having a
current version.

**Paths follow the language, per call rather than per process.** `soundsDir(lang)`,
`manifestPath(lang)` and `historyDir(lang)` replaced the module constants: the CLI runs
one language per process and passes nothing, while the explorer serves all of them at
once. The environment overrides on the droplet name English's paths, and another
language derives its own beside them, so one setting still decides where audio lives.
`audio-history/` nests non-English under its code, because two languages sharing one
version sequence for the same file would make a restore install the wrong clip.

**Each language has its own narrator, picked on its own `/voice` page.** English is
`pipelines/zones/tools/voice/config.json`; every other language is `pipelines/zones/tools/voice/config.<code>.json`
merged over it, holding only what changes with the language — voice, model, `language_code`,
pronunciation dictionary, voice settings. `/deDE/voice` reads and writes the German file,
and the first save there is what creates it, with the language code filled in and the
English phoneme dictionary explicitly *not* inherited (an English dictionary applied to
German rewrites words that happen to be spelled the same). The page also holds the
language's ElevenLabs pronunciation dictionary id — one per language, checked against
the account on save, its newest version resolved at the start of every run. A preview works before that
first save, because auditioning is how the narrator gets chosen.

**Regenerating in a language with no voice refuses.** `loadConfig(lang)` throws unless
that file exists and names a voice. That is the right answer to "narrate this in
German": there is no German narrator until somebody picks one, and cutting it with the
English voice would spend credits on a take nobody wants. A quote still works — it is
free, and it loses only the measured credit rate.

**The report page reads in its language.** The explorer is an editors' tool and its
interface stays English, but `/{lang}/r/…` and the feedback form on it are what a
player lands on from the addon's Report button, and they read in the language of the
lore they show. `web/src/lib/messages.ts` holds those few dozen strings per language,
English as reference and per-key fallback — no i18n library, because the set is that
small and grows only when another player-facing surface appears. The non-English
tables were machine-written and await a speaker's review.

**Flags and feedback are per language too** (migration 0010). A `bad` verdict under
`/deDE` puts the German line on the German worklist and leaves the English one alone;
a report filed from a German page counts against the German line, and `/deDE/feedback`
is the German triage list. Both APIs take `lang` and default it to English, so links
and forms that predate the axis still land where they always did.

## Map highlight

On a zone map, the area under the cursor lights up when a click there would open its story in
the panel, as the continent map lights the zone under the cursor. The highlight is the area's
own exploration overlay drawn again over the map in additive blend; only explored areas have
one, which are also the only ones a click resolves. There is no tooltip: the panel tells the
story once the area is clicked.

## Minimap button and lore window

A minimap button (LibDBIcon) is the entry point that does not need the world map
open. Its tooltip shows lore for wherever the player is standing -- the subzone if
there is one, otherwise the zone. **Left-click** opens the lore window,
**right-click** opens the settings panel. `/spz minimap` hides or shows it.

Right-click was originally a world-map-panel toggle, which is also an options
checkbox and a slash command — three ways to reach one setting, and none of them
the one people reach for on a minimap button.

The lore window is movable, closes on Escape, and browses everything: the left
column lists all zones, and clicking one expands its subzones beneath it.

It re-syncs to where the player is standing on **every** open, not just the first,
and scrolls that row into view. If the player is standing in a subzone that has
lore, that subzone is selected rather than the zone, since it is the more specific
answer. The player's map is resolved through `GetLoreWithFallback`, because
`C_Map.GetBestMapForUnit` can return an indoor or micro map -- an inn, a dungeon --
which is not itself a key in `Zones`.

### Why the list is an accordion

Only one zone expands at a time. That caps the row count at about 108 (49 zones
plus Ashenvale's 59 subzones), which is few enough that every row can be a real
button with no view virtualisation. Expanding everything at once would be 1353
rows, so the accordion is a constraint rather than a preference.

Zones are sorted alphabetically by the name the *client* reports, not by uiMapID,
which is meaningless to a reader.

### Library-owned saved variables

LibDBIcon writes two keys directly into `ZoneLoreDB`: `hide` and `minimapPos`.
Neither is in `Core.lua`'s defaults table, because a default there would fight the
library. `minimapPos` is seeded once in `UI/MinimapButton.lua` so the button does
not start at angle 0 underneath other addons' buttons. ZoneLore's own
`showMinimapButton` option is authoritative and is mirrored onto `hide`.

## Narration

Every lore description carries a **Play** button — top-right of the world map
panel and of the lore window. `/spz play` narrates wherever the player is standing,
preferring the subzone over the zone when the subzone has lore of its own.

Audio ships in **separate sound-pack addons**, all of them optional. ZoneLore
looks up a clip in whichever pack is active — see "Sound packs are
self-describing" — and where there is no clip there is no sound: the Play button
does not appear, autoplay does not queue the entry, and asking for it by hand says
whether the pack is missing or merely does not cover that line. `/spz audio`
reports which packs are installed.

**Nothing stands in for missing audio.** A placeholder clip used to — a quest line
borrowed from `../wow-voiceover`, returned for every uncovered entry, which on a
client with no pack installed is every entry there is. Players heard unrelated
quest audio about the League of Arathor over Elwynn Forest, Dun Morogh and Felwood,
and reported the lore as wrong. Silence is honest about what is missing; a
convincing substitute is not. If the playback controls ever need exercising without
a pack again, that is a debug flag, not a file every player ships.

### The beta disclaimer, and the files that carry it

The shipped voice is a first pass, and the places that describe it say so. The
wording is duplicated rather than shared, because Lua and TypeScript cannot import
from each other and a `.toc` cannot import from anything — so these are edited
together, and all of them become wrong on the same day, the day the redesigned
voice ships:

| File | Where it shows |
|---|---|
| `addons/Spoken_Zones/Spoken_Zones.toc` and `addons/SpokenZonesAudio/SpokenZonesAudio.toc` (`## Notes:`) | the in-game addon list, and the CurseForge blurb |
| `addons/Spoken_Zones/README.md`, `addons/SpokenZonesAudio/README.md` | the two CurseForge project descriptions |
| `web/src/lib/beta.ts` | the **beta** badge beside the logo on lore.rusty.one |

**Descriptions only, in the addon.** Nothing in the client says any of this out
loud: not `/spz audio`, not the options panel, and nothing at login or on first
playback. A player who has installed the pack has already read the description
that came with it, and an addon that repeats its own caveat into chat is an addon
that talks over the thing it is apologising for.

The site is the exception, and only because it has room to be: the badge is
silent until it is clicked, and what is behind it ends on the Support ask, for the
same reason `SUPPORT_REASON` exists — the sentence explaining that the re-record
is waiting on money is unfinished without somewhere to send the reader who wants
to do something about it.

### Autoplay on discovery

On by default: **the game's own discovery is the trigger** — the moment it prints
"Discovered Durotar", that zone's lore plays. `/spz autoplay` toggles it, and `/spz`
reports whether the feature can work at all on this client.

Subzones are included, and are most of what fires — a walk across Elwynn sets off
several. They queue rather than interrupt, so the effect is a steady trickle of
lore rather than a pile-up; the second option turns them off if it ever feels
constant.

#### Why discovery, and not "first visit"

A first attempt tracked first visits per character and got all three of its cases
wrong, for one reason: **standing in a subzone already resolves to its parent
zone.** A new orc in Valley of Trials has `GetBestMapForUnit` answering "Durotar"
from the first second, so:

- No zone-change event ever fires when they walk out into open Durotar. Nothing to
  hook.
- Anything that treats "the player's zone resolves to Durotar" as arrival consumes
  Durotar's first visit inside the starting cave, minutes before the player sees
  the zone. It then narrates Durotar while they are standing in The Den, and stays
  silent at the actual moment of discovery.

The client already tracks exploration exactly, remembers it per character across
sessions, and announces it at precisely the right instant. There is no reason to
reimplement that, and no way to reimplement it correctly.

The consequence is that a character who has already explored the world will never
autoplay anything — the discoveries have all happened. `/spz discover [area]`
simulates one, which is the only way to test this without rolling an alt.

#### The spawn area, which is never announced

Where a character starts is the one discovery the client never reports: it is
either already explored the moment the character is created, or announced while the
intro cinematic is up, before any addon has registered an event. Either way a new
orc stands in Valley of Trials in silence — which is the first thing this feature
should ever have to say.

So the spawn area is seeded two seconds after entering the world, guarded by one
per-character boolean (`ZoneLoreCharDB.greeted`). This is a greeting rather than a
rule: it fires once per character and is the only place left that infers a first
visit instead of being told about one. The greeting queues immediately and the
queue holds it until the intro ends — but two seconds is not always before the intro
starts, so `CINEMATIC_START` and `PLAY_MOVIE` also stop a greeting already speaking
and keep it queued, to replay from the start once the intro is over. The greeting's
attempts are not spent while an intro plays: on clients that play it somewhere else,
with a loading screen after it, every answer during it is wrong, and a player who
watched it to the end used to arrive after the last attempt.

The flag is set *after* the enabled check, so turning autoplay on later still
greets rather than having silently spent its turn. `/spz forget` clears it.

Because the greeting and a real discovery message can name the same area, and an
area on a zone border can be announced twice, the queue rejects a duplicate of
anything already queued or playing. Narrating something twice in a row is worse
than missing it.

#### Reading the client's own strings

The messages are matched with patterns built at runtime from `ERR_ZONE_EXPLORED_XP`
("Discovered %s: %d experience gained.") and `ERR_ZONE_EXPLORED` ("Discovered
%s."), read from the running client. Deriving the patterns from the globals rather
than hardcoding English makes this work in every locale for free, and makes a
Blizzard rewording a non-event.

Four events are watched — `CHAT_MSG_SYSTEM`, `CHAT_MSG_COMBAT_XP_GAIN`,
`UI_INFO_MESSAGE` and `UI_ERROR_MESSAGE` — because the message's route is not worth
betting on. The text lives in a global named `ERR_*`, and `ERR_` strings normally
arrive on `UI_INFO_MESSAGE`; but exploration also awards experience, which is
`CHAT_MSG_COMBAT_XP_GAIN` territory. Registering all four costs nothing, since
anything that is not a discovery fails the patterns, while betting on one costs a
play session to find out.

Their payloads are not shaped alike: `CHAT_MSG_*` put the text first, `UI_*_MESSAGE`
put a numeric message type first and the text second. Rather than encode that per
event, the handler takes whichever argument is a string.

`/spz` reports how many of the two message forms the client defined; zero means the
feature cannot fire and says so, rather than being silently dead. With `/spz debug`
on, every message arriving on any of the four events is printed with the event that
carried it — which is what to look at if discoveries are not being recognised.

### Testing autoplay

**A discovery happens once per character, ever.** Re-entering an area that has
already been explored produces no message and therefore no narration — so walking
back into The Den proves nothing, and neither does any character that has already
been played. This is the single easiest way to mistake the feature for broken.

```
/spz discover              pretend to discover the subzone you are standing in
/spz discover The Den      pretend to discover a named area
```

That runs the same path a real discovery takes, short of the message parsing. To
exercise the parsing itself, turn on `/spz debug` and walk into genuinely unexplored
ground; every message on the four watched events is printed with its event name.

`/spz forget` clears the greeting flag, so the spawn-area greeting can be heard
again on the next login without rolling another character.

#### Queue

Discoveries queue rather than interrupt, capped at 3 waiting and dropping the
oldest. The cap matters more with subzones on: crossing a cluster of small areas
can announce several within a minute, and narration that has fallen minutes behind
is describing somewhere already left.
Combat and cinematics hold the queue rather than dropping it: the retry ticker
plays them once the pull or the intro movie ends. A starting-zone cinematic is the
one moment a character is guaranteed to be discovering things, so it is the
likeliest collision there is, and the only hold that also interrupts: a cinematic
starting stops a narration already speaking, which replays once it ends.

**Stop clears the queue.** Stop has to mean silence, not "skip to the next place I
discovered on the way here".

##### One queue, ported from VoiceOverRedux

There used to be two halves of a queue: `Audio.lua` held the clip that was
playing, `Autoplay.lua` held a list of areas waiting behind it, and the two
coordinated through a callback and a staleness token. `SoundQueue.lua` is now a
port of `VoiceOverRedux`'s file of the same name, and there is one list — the clip
being spoken is simply its head. Autoplay decides what deserves narrating and
hands it over; the depth cap, the deduplication and the retry after combat belong
to the queue.

It is a port rather than a rewrite because both addons are eventually meant to
share one player, so that quest voiceover and zone lore cannot talk over each
other, and an extraction from one lineage is a smaller thing than a merge of two.
`SoundQueue.lua` and `SoundUtils.lua` are the files that would move; `Audio.lua`
stays, because packs, languages and map areas are ZoneLore's alone. Those two run
inside the private environment set up in `QueueEnv.lua`, keeping upstream's
`setfenv` idiom so its fixes re-apply by diff — every deliberate departure is
listed in each file's header.

**Waiting, not queued, is what gets counted.** A player who started one clip and
nothing else has an empty queue, not a queue of one — which is what makes "Stop
becomes Next" and the cap of 3 mean what they say.

**Combat holds only what autoplay queued.** Pressing Play during a pull has always
meant now, so the hold takes the entry it is judging rather than only the moment:
a clip the player asked for by name plays through combat, and a discovery waits.
That is also why Play inserts at the front rather than appending — behind a
backlog it would be a wait, and behind an entry held for combat it might never
arrive at all.

#### What is waiting

The player names each queued area under the one being spoken, and says why
anything is being held — "waiting for combat to end". Clicking an entry drops it.
Before this, a held discovery was indistinguishable from a discovery that failed.

### The player

While anything is playing or queued, a movable frame appears: a portrait, the zone
above the area being narrated, the backlog under that, and **Read** and **Report**
beside it. Clicking the portrait stops the story, and again replays it. Drag it by
the handle on the portrait's corner; `/sp reset` brings it back to the middle of the
screen; the options panel turns it off.

It is ported from `VoiceOverRedux`, the quest-voiceover addon, and is deliberately
the same widget down to the atlas coordinates — a player running both should not
have to learn two players, and the two addons are meant to end up sharing one
outright rather than merely resembling each other.

**The portrait is always the book.** Redux draws a 3D model of the NPC speaking and
falls back to a book when there is no model to draw. A zone has no speaker, so the
fallback is the only case here, and everything the model brought with it — the
`DressUpModel`, `SetCreature`, the animation timer, the retry-until-cached
`OnUpdate` — went with it.

It exists because the Play buttons are attached to a description, so they are only
reachable while that description is on screen — and narration deliberately outlives
both panels. Without this frame, closing the map would leave a clip running with no
way to stop it short of `/spz stop`.

**Stop and Replay, not pause.** The client can start and stop a sound file and
nothing in between: there is no seek, and no way to ask how far into a clip playback
has reached. So the button says what it does: Stop while a story is read, Replay
once it is stopped, which plays it from the beginning, and Play when it has ended
(`SoundQueue:PauseQueue` and `ResumeQueue` keep their old names).

#### What replaced the playback bar

There used to be a small Pause/Stop widget anchored below the minimap, with Stop
relabelling itself to "Next" whenever the backlog was non-empty and right-click
reserved for stopping outright. The player supersedes it: the backlog is now
listed rather than counted in a tooltip, so skipping one entry is clicking that
entry and stopping everything is `/spz stop`, and neither needs a button that means
two things depending on state.

### One clip at a time, stopped only on purpose

Starting a clip stops whatever was playing. Nothing else does: closing the map,
navigating it, walking into another zone and hiding the lore window all leave the
narration running.

Stopping when the entry scrolls out of view reads well as a rule and is wrong in
practice — the intended use is to start a zone's lore, close the map and walk,
which that rule would cut off immediately. The button always reflects the entry in
front of it, so stopping is one click, or `/spz stop`.

### Why the button resets itself from recorded data

The client fires no event when a sound finishes, so the only way the button knows
to flip back to *Play* is a duration recorded when the audio was made and shipped
alongside it. That is why durations are part of the generated lookup table rather
than an afterthought.

`PlaySoundFile` returns false both for a missing file and for a muted sound
channel. Audio.lua checks `Sound_EnableAllSound` and `Sound_Enable<Channel>` first
so the two are reported differently, which is the same distinction
`VoiceOverRedux`'s `Utils:IsSoundEnabled` exists to make.

The sound channel is configurable and defaults to **Dialog**, so narration follows
the Dialog volume slider instead of competing with it. The options panel cycles
through the five channels with a button rather than a dropdown: `UIDropDownMenu`
works on 11509, but none of its `Initialize` plumbing can be checked without
launching the game, and five values do not justify that. Same trade as the
hand-rolled scrollbar below.

## Generating voicelines

Audio is synthesized with ElevenLabs (`narrator-male`, model `eleven_v3`) and
written into the `ZoneLoreAudio` addon. **1353 lines, 672,550 characters — about
408,000 credits and 14.4 hours of audio** on this plan (see "Characters are not
credits" below).

None of it needs a key: reporting on lines is offline work, which is what makes the
cost of a run checkable from a laptop with no credentials.

```sh
node tools/voice/generate.mjs --all                     # what the whole corpus costs
node tools/voice/generate.mjs --zone Durotar            # one zone and its subzones
node tools/voice/generate.mjs --all --zones-only        # the 49 zone lines
node tools/voice/generate.mjs --missing --stale         # what needs work
```

A selection of 60 or fewer — a zone and its subzones — lists every line, largest
first, with its cost, whether it is new, stale or current, and a `short` marker on
anything under 250 characters, where v3 is least reliable. `--list` forces the
full listing for a larger selection.

```
44 lines, largest first:

  1188ch ~ 721cr  current Southfury River        1411/southfury-river
  ...
    83ch ~  50cr  current Spitescale Cavern      1411/spitescale-cavern short

  11 under 250 characters (marked "short"): v3 is least reliable there, so listen
  to those first.
```

Selectors combine, and a `--zone` takes an id or a name (`--zone 1411`,
`--zone "The Barrens"`) and pulls in that zone's subzones. `--missing` is anything
with no audio, `--stale` anything whose **spoken** text has changed since it was
made, `--older-than <date>` anything generated before then, `--limit n` caps it.
`--dictionary-drift` is the one that needs `DATABASE_URL`: the dictionary a take is
compared against is the `pronunciation_lexicon` row, which is what the site
generates with.

### Where the cutting happens

Not here. `generate.mjs` answers which lines exist, which are missing audio, which
have had their text rewritten since they were cut, and what re-cutting them would
cost. Turning that into audio is the site's: select the lines on `/zones` and
regenerate, which queues them against the signed-in editor's own ElevenLabs key.

One generator, on one box, is deliberate. It is what keeps the shared queue's
advisory lock meaningful, what keeps every take recorded with the voice and
dictionary version it was actually made with, and what stops a laptop spending
against an account it happens to hold a key for.

Stage anyway — a zone, listen, then the rest. ElevenLabs bills per character either
way, so nothing is saved by going straight to a full run, and the short entries are
the ones to hear first: v3 is documented as unreliable below 250 characters and
**305 of the 1353 entries are shorter**.

The takes stay on the droplet. To build a pack from them, bring them home with
`make zones-sync` and then `make zones-pull-live`, which fetches only the takes the synced
rows mark live; `make zones-package-audio` assembles `Sounds/` from them and rebuilds the
lookup table. `make zones-full-release` does all of it and, after asking, uploads the pack.

### How long a full run takes

Requests run in parallel, and the budget comes from **the account's plan** rather
than a constant, because ElevenLabs limits concurrency per plan and per model
family and publishes the numbers: 2 on free, 3 starter, 5 creator, 10 pro, 15
scale and business, with flash models doubled. The tier is read once from
`GET /v1/user/subscription`; `--concurrency n` overrides it.

An unrecognised or unreadable tier falls back to **2**, not to the highest —
finding out the plan is unknown must not be the moment this code is at its most
aggressive.

A 429 means the published number is wrong for right now — another process on the
same key, or a limit that moved. The budget halves and stays halved for a minute
rather than retrying into a wall, then restores itself. The limiter resizes while
requests are in flight, so this costs no restart.

The manifest is written by every worker after every line, so writes are serialised
and go through a temp file and a rename. Two concurrent writers on one path
interleave into invalid JSON, and this is the one file here that cannot be
regenerated — it is the record of everything already paid for.

### Square brackets are the one hard rule

Eleven v3 reads bracketed text as an **audio tag** — a performance direction — so
`[Deviate Fish]` would be acted rather than spoken. The lore carries 163 bracketed
spans. `pipelines/zones/tools/voice/normalise.mjs` drops IPA guides (`Kalimdor [ˈkælɪmdɔɹ]`) and
level ranges entirely, and unwraps the rest to keep the words. The generator
refuses to start if any bracket survives, and `validate-audio.mjs` checks it too.

The **spoken** text is what gets hashed into the manifest, so editing
`pipelines/zones/tools/voice/pronunciation.json` correctly marks the lines it affects as `--stale`.
That file ships empty on purpose: every rule in it is a claim that the model
mispronounces a word, and that claim can only be made after listening.

### The pronunciation lexicon lives on the quests side

> Both projects are one site now. The lexicon did not move: it is edited at
> spoken.rusty.one/lexicon, which is the same editor under a shared roof, and the paragraph
> below still describes why zone lore does not have one of its own.
>
> Two details below have since changed. **The id no longer crosses between projects as a
> config key**: `dictionaryId` is gone from `config.json`, and both the drift selector and
> `validate-audio.mjs` read the locator from the `pronunciation_lexicon` row, which is what
> the site generates against. And **the version is no longer resolved per run** — the row
> carries the version last synced to ElevenLabs, so the comparison is against what a line
> would actually be cut with today rather than against whatever is newest at the API.

#### As it was written

A mispronounced name is fixed **in `../wow-voiceover`**, at its `/lexicon` page,
not here. That project narrates a different corpus on the same ElevenLabs account
and gets the same names wrong, and it already has what this side never built: an
editor, 134 curated entries, IPA phoneme rules alongside plain respellings, and a
check that reads every upload back to see what ElevenLabs actually kept.

What crosses between the two projects is **one id per language**, and nothing else.
No shared database, no API call, no exported file. English's is `dictionaryId` in
`pipelines/zones/tools/voice/config.json`; every other language's is in its `config.<code>.json`,
and is set on that language's **`/pronunciation`** page — which, for now, is that one
field. A dictionary is never inherited from English: an English phoneme dictionary
applied to German rewrites words that happen to be spelled the same, so a language
starts with none until somebody names one, and the page checks the id against the
account on save.

voiceover updates a dictionary in place on every save, so the id never moves. Only
the id is stored: the API wants an id *and* a version, so the generator resolves the
latest version at the start of every run and uses it for the whole run — the
newest rules always apply, and every take records which version it was spoken with,
so drift stays knowable per line. Writing a `dictionaryVersionId` into the config
by hand pins it and skips the per-run resolution.

**A lexicon change does not mark anything stale, and that is deliberate.** The
rules are applied by the model, not by rewriting the text, so the spoken text and
its hash do not move — and `--stale` is a text comparison. Re-cutting 1,353 lines
because a name was corrected is a ~408,000-credit decision, so it is never made
by a flag that means something else. Every generated line records the dictionary
id and version it was spoken with, and that provenance is reported: dry runs
count the lines made with an older dictionary, and `--dictionary-drift` selects
them for anyone who wants exactly that.

`validate-audio.mjs` checks the other half — that the shared dictionary covers
*this* corpus. A phoneme rule cannot be case-insensitive, so voiceover uploads one
rule per spelling **its** corpus contains; a name this lore text capitalises
differently would have no rule at all. That is reported as a note, with the fix
being an entry in voiceover's editor. The check needs the network, so it skips
itself rather than failing when there is no key.

`pipelines/zones/tools/voice/pronunciation.json` is what remains here, and it is now the last
resort rather than the route. It rewrites the text before it is sent — spelling
"Kalimdor" as "Kalimdore" and hoping — which is worse than a phoneme rule
wherever a phoneme rule works, and it is the only mechanism that *does* move the
text hash. Reach for it when a line needs different words, not a different
pronunciation.

### Characters are not credits

ElevenLabs bills `round(characters × rate)`, and **the rate belongs to the plan,
not the request**. On this account with `eleven_v3` it is **0.607**, measured over
the first 44 generated lines — so the corpus is 672,550 characters but roughly
**408,000 credits**.

That number is measured rather than assumed, because assuming it was wrong twice:
0.55 carried over from the sibling project understated the bill by 10%, and 15
characters/second understated the runtime by the same (it is 12.9). Every
generated line records what it actually cost and how long it came out, so the dry
run derives both from the manifest and says how many lines it measured over. The
`config.json` values are only the answer for an empty manifest.

The `character-cost` response header is always authoritative, and is what the
manifest stores.

### What is committed, and what is not

`pipelines/zones/tools/voice/manifest.json` (what exists, when it was made, from which text) and
`addons/SpokenZonesAudio/Data/Sounds.lua` (the generated lookup) are committed. The
mp3s are not — `addons/SpokenZonesAudio/Sounds/` is gitignored, like
`../wow-voiceover`'s `audio/`.

`pipelines/zones/tools/voice/naming.mjs` owns both the line id and the file path, and nothing else
derives either. The addon resolves clips through the lookup table, so a filename
that drifts plays silence rather than failing — which is why `validate-audio.mjs`
checks the manifest, the files on disk and the lookup table against each other, and
why `package-audio.sh` refuses to build without it.

### Bitrate is a packaging decision, not a generation one

ElevenLabs bills **characters, not bytes**, so output format does not change the
price. Audio is generated at the default 128kbps and shrunk at packaging time:

```sh
./scripts/zones/package-audio.sh              # both tiers
./scripts/zones/package-audio.sh standard     # just the 64kbps one
./scripts/zones/package-audio.sh high         # just the masters
```

Generating at a low bitrate to save money would save nothing, and would make a
later quality bump a second purchase rather than a re-run. The repository holds
the masters; every shipped tier is derived from them.

### Sound packs are self-describing

A tier is an addon folder of its own — `SpokenZonesAudio` at 128kbps,
`ZoneLoreAudio64` at 64 — rather than two files under one project. One project
with two files would mean the addon manager silently "updating" a player from the
tier they chose to whichever file is newest, which is a 400MB surprise.

The full-quality pack holds the unqualified name because it is the one a player
should land on without having to make a decision first; the smaller tier names its
own trade-off, so nobody installs it wondering what "64" cost them.

Separate folders means ZoneLore cannot hardcode where the audio is. Each pack
registers itself:

```lua
ZoneLoreAudioPacks[ADDON_NAME] = pack
```

...keyed by folder name, so two installed tiers both appear instead of the second
clobbering the first. The pack reads its own folder name, quality and bitrate out
of its `.toc` through `GetAddOnMetadata` at load time, which is what lets a single
generated `Data/Sounds.lua` serve every tier — `package-audio.sh` rewrites three
`.toc` lines per tier and changes nothing else. Adding a 32kbps tier later is a
line in that script.

ZoneLore picks the highest bitrate installed unless the player has chosen
otherwise, and stores that choice as a folder name rather than an index: someone
who uninstalls the higher-bitrate pack should fall back to what remains, not to whichever
pack happens to occupy that slot afterwards.

`pack.version` is the compatibility contract, checked against `PACK_FORMAT` in
`Audio.lua`. A pack whose format this build does not know is skipped with a
message in chat, because the alternative — reading an unknown layout hopefully —
plays silence and reports nothing, which is indistinguishable from a broken
install.

## The voiceline explorer

The generator can tell you a clip exists and what it cost. It cannot tell you it
sounds *wrong*, and until `web/` there was nowhere to record that you noticed. With
1353 lines and no record of what has been heard, a listening pass cannot be resumed —
which in practice means it never gets started.

```sh
cp ../../.env.example ../../.env   # DATABASE_URL is already filled in; add your API key
make zones-db-up                # Postgres on 5433, then migrations
make web-db-pull                # production's rows, since the database is the record
make zones-web                  # http://localhost:3000
```

Browse and filter all 1353 lines, play them, flag what is wrong, fix it, regenerate.
Keys: `/` search, `space` play/pause, `j`/`k` next/previous, `f` bad, `g` ok, `u`
undo, `n` note. The pass it exists for is `?state=current&flag=unreviewed` — hold `j`
and listen, tapping `f` on anything wrong. `?flag=bad` afterwards is the worklist.

Filters live in the URL, so the back button undoes a filter change and a link carries
the exact view.

### Port 5433, not 5432

`../wow-voiceover`'s Postgres already holds 5432 on this machine, and both schemas
have a table of voicelines with a `file` column. Connecting to the wrong one silently
is the worst outcome available here.

### The database is authoritative; the manifest is an export

`voiceline_take` holds every take of every line, not just the live one, so a re-roll
that comes out worse can be undone — the superseded mp3s go to `audio-history/`
(gitignored, a *sibling* of `Sounds/` because `validate-audio.mjs` walks `Sounds/`).

`pipelines/zones/tools/voice/manifest.json` is still committed and is still what `build-lookup.mjs`
turns into the addon's lookup table. It stopped being hand-maintained and became an
export: `make zones-lookup` runs `export-manifest.mjs` before `build-lookup.mjs`. **The
addon build never learns the database exists** — with `DATABASE_URL` unset the build
tools read the committed file, so a clone with no Postgres can still build the addon.
It cannot generate audio: takes are cut only by the site.

`pipelines/zones/tools/voice/store.mjs` is read-only. Takes are written by
`apps/web/src/lib/takes/commit.ts`, which all three sections share; this module used to
hold the zones copy of that, and the web app borrowed it.

The check that proves the committed file is current: `export-manifest.mjs --check` must
report no change, and `validate-audio.mjs` must still pass.

### Regenerating costs money, so it says so first

One line goes straight through — it is one click, it is cheap, and the archive makes
it reversible. Anything larger quotes first, priced from `measureRates()`, the same
0.607 credits/character measured over real billing that the CLI's dry run uses.

The web app imports `pipelines/zones/tools/voice/elevenlabs.mjs` directly rather than spawning the
CLI, so the typed failure kinds and the `character-cost` header reach the take row
instead of being parsed back out of stdout. This needs `outputFileTracingRoot` in
`web/next.config.ts` pointed at the repo root, without which Next traces dependencies
from `web/` alone and leaves `pipelines/zones/tools/` out of the build.

Batches run in-process with progress in memory — no queue tables. Those exist in
`../wow-voiceover` because two pm2 workers share one billing account; here there is
one process. The work is server-side so closing the tab does not strand it. A server
restart does, and that is a real limitation rather than one worth engineering around.

### Deployed at lore.rusty.one

Pushing to `master` deploys the explorer to a DigitalOcean droplet — the same one
`../wow-voiceover` runs on, beside it rather than tangled with it: its own `/srv` tree,
its own database, its own pm2 app, and **port 3001**, because voiceover holds 3000.
CI builds and tests, ships a Next.js `standalone` bundle, and swaps a symlink;
`deploy/README.md` is the full account, including first-time droplet setup.

**The site is public to read and closed to write.** Anyone may browse, filter and listen —
that is why it is hosted at all. Everything else needs an account *and* a role:

| Role | May |
|---|---|
| *(nobody)* | browse, filter, search, play, download a clip, **file feedback** |
| `member` | exactly the same. Registering grants nothing |
| `editor` | Regenerate, which spends credits; Restore; rewrite a line's text; read and resolve feedback |
| `admin` | also edit the pronunciation rules, and grant these roles at `/admin` |

`member` doing nothing is the point: the site is reachable from the internet, so anything
a fresh registration unlocked would be unlocked for everyone. The first admin is promoted
with one line of SQL — see `deploy/README.md` — because "the first account wins" is a race
anyone could enter.

The roles are defined once in `web/src/lib/permissions.ts` and shared by the browser and
the server. What the browser decides is only what to draw; `web/src/lib/authz.ts` decides
what actually happens, and does it again on every request.

**A role is only half of it: the credits are the editor's own.** The site holds no
ElevenLabs key. Each editor sets theirs on `/profile`, where it is encrypted
(AES-256-GCM, under the droplet's `SPOKEN_SECRET_KEY`) before it is stored and is never
shown again — only its last four characters. Anyone without one is refused with a dialog
saying so, before anything reaches ElevenLabs. An admin can see which accounts have a key
and clear one, never read it. There is no second path: `pipelines/zones/tools/` holds no
ElevenLabs client and reads no key.

The one thing worth knowing here rather than there: **`pipelines/zones/tools/` paths are overridable by
environment variable, and on the droplet all five are overridden.** Every path under
`pipelines/zones/tools/` derives from `ROOT` in `pipelines/zones/tools/lib/loredata.mjs`, which is the module's own
location — and cannot be, once webpack has compiled it, because webpack replaces
`import.meta.url` at *build* time. A bundle built in CI otherwise looks for the lore
corpus under a GitHub runner's checkout path. So a deployed process is told instead:

| | |
|---|---|
| `ZONELORE_ROOT` | the release directory — corpus and voice config move with a rollback |
| `ZONELORE_SOUNDS` | shared, so ~700MB is not copied per deploy or deleted by a prune |
| `ZONELORE_AUDIO_HISTORY` | shared; this one's loss is permanent |
| `ZONELORE_MANIFEST` | shared; write-only, since the database is authoritative |

Unset — every local run, CLI or `next dev` — each falls back to exactly the path it
always had. Nothing about working locally changes.

### Feedback is the one thing the world may write

Filing feedback is the single exception to "public to read, closed to write", and it is
the exception the rest of the table exists to make safe. A visitor who hears a
mispronunciation or spots a Cataclysm sentence the era filter let through is the cheapest
source of corrections this project has, and before `feedback` they had nowhere to put it.

Two entry points, both open to anyone signed in or not: the **Feedback** button in the
header, for anything that is about no particular line, and a small ✍ button in each row's
State column, for a report against that line. A category is asked for up front — lore,
audio, pronunciation, other — because it decides who looks: pronunciation is a dictionary
rule, audio is a re-roll, lore is the scraper or an override. Name and email are offered
and optional; submitting anonymously is expected and fine. A signed-in reporter is
identified by their account and is not asked.

Editors and admins read them at **`/feedback`**, newest first, filtered to `open`,
`resolved` or `all`, and close each one as **not an issue** or **fixed** — a report is a
claim, not a verdict, so "not an issue" is a normal outcome. Reopening is always possible.
The same reports also expand inline in the explorer, and `?fb=open` narrows the table to
lines carrying an unresolved one.

**The editor's review flags are gone; feedback is the one worklist.** `line_flag` held
one editor's verdict per line -- `bad`, `ok`, or a note -- beside the reports a visitor
files, and the explorer carried a Review column for it. Two worklists over the same lines
meant two places to look and two things to keep clear, and only one of them was fed by the
people actually listening. So the verdicts, the note dialog and the column were removed,
and a problem with a line is now said in exactly one way: a report.

The `line_flag` table is left in place, unread. It is forward-only like every other table
here, and it still holds the era attributions the full-corpus review wrote --
`tools/fix-flagged.mjs` was built to spend model credits on those notes and is retired
with them. Reviving that pass means pointing it at `report` first.

**Open counts are public; report bodies are not.** The badge on a row and the `?fb=open`
filter travel with the search results, because "someone has already reported this one" is
the answer to the question a dissatisfied listener is about to ask — the same reason the
`bad` badge is visible to a guest. The prose behind it is behind `requireFeedback()`.

Two things stand between `POST /api/feedback` and the internet: a honeypot field a person
never sees and a bot fills in — answered with `200` and no row, because a `400` teaches
the script to stop sending it — and a cap of ten submissions per IP per hour, counted in
Postgres rather than in memory so it survives a pm2 restart. Resolving lives at
`/api/feedback/resolve`, its own route rather than another action on the public one:
two verbs on one path with opposite access rules is an arrangement a later edit quietly
breaks.

### A gap has no text to send, only a place

Every zone and subzone the client can name is already in the corpus; what is missing for some
of them is the lore itself. So a gap is not reported, it is written. Where the map panel says a
place "is on the map, but nobody has written its lore yet" (or that there is no lore for it at
all), a **Contribute** button sits right under that sentence, in the panel's body -- and the
same in the lore window, for whichever zone or subzone is selected in its list. It sends the
place the panel is showing -- the map, the zone's name, the subzone -- not where the player
stands, since a place can be described from anywhere. The client has no text to hand over, so
the envelope carries none.

The contribute page asks for the missing part: for a zones paste it replaces the optional
"Anything to add?" with a required **Describe this place** (at least 20 characters), and that
description is stored as the contribution's text, where every other source keeps what it sent.

The envelope travels the same plain-text format and the same `spoken.rusty.one/contribute` page
as the quests and books ones, for one reason: one triage queue for three addons. What
differs is only what is in it. Two players describing the same place in different words are two
rows under one key, and the same description sent twice bumps a count instead.

### Bringing the audio home

Every take is one file in the droplet's archive, `shared/audio-history/zones/`, written
once by the site and never changed; which take is live is a flag on its row. Takes are cut
there and nowhere else, so audio only ever comes home. The droplet is named by the
environment and not by the repo — `export SPOKEN_DROPLET=deploy@<host>`, or pass
`DROPLET=deploy@<host>` for one invocation. See `make/droplet.mk`.

```sh
make zones-history-status   # archived takes, local and droplet, side by side
make zones-pull-history     # every take the droplet has (never deletes)
make zones-sync             # the lore and take rows
make zones-sounds           # addons/SpokenZonesAudio/Sounds from the live takes
make zones-lookup           # rebuild Sounds.lua from the database
```

`Sounds/` is not kept: it is thrown away and assembled again from the live takes before
every build, so nothing in it is ever the only copy of anything.

No `-z`: mp3 is already compressed, so it is pure CPU for nothing. The rsync-3.x
preflight is load-bearing — macOS ships openrsync as `/usr/bin/rsync`, which reports
itself as "2.6.9 compatible" and rejects `--info`.

`audio-history/` grows without bound: re-cutting the whole corpus adds another ~795MB.
There is no prune command yet.

## Options

`/spz options`, or Game Menu -> Options -> AddOns -> ZoneLore. Registered with
`Settings.RegisterCanvasLayoutCategory`, which exists on 11509 -- Leatrix_Maps,
Leatrix_Plus, Leatrix_Sounds, Syndicator and Baganator all use it.
`InterfaceOptions_AddCategory` is the legacy-only path and is deliberately not
used.

Exposed: map panel on/off, panel side, panel width, font size, minimap button on/off, narration on/off, autoplay on/off, autoplay for
subzones on/off, the playback controls on/off, the narration sound channel, and the
debug area-name reporting. Everything applies immediately -- no reload -- via
`ZoneLore:ApplyPanelOptions()`.

Widget templates were chosen from what addons already running on this client use
rather than from memory: `UICheckButtonTemplate` (`Syndicator/Options`) and
`UISliderTemplate` (`Syndicator/Options`, `Leatrix_Maps`, `Leatrix_Plus`).
`SetObeyStepOnDrag` is called behind a presence check.

### The scrollbar

`UI/TextView.lua` now draws a track and a draggable thumb, auto-hidden when the
text fits. This is hand-rolled rather than inherited from `ScrollFrameTemplate`.
That template *does* give a native bar on 11509 -- `Leatrix_Plus` uses it -- but
only through XML `KeyValues` naming a `scrollBarTemplate`, and none of that
plumbing can be checked without launching the game. For cosmetic polish a
deterministic 50 lines beat untestable inheritance. The wheel works either way.

This closes the last item left over from sidestepping
`UIPanelScrollFrameTemplate` back in M2.

### Fixing a line by hand

Rewrite it in the explorer. The pencil beside a line opens its text, and saving
records a new version in `lore_line` — the corpus lives in the database so that
the person who notices a bad line is the person who can fix it, without a
checkout. Editors and admins may do this; it costs nothing, and the rewritten
line simply becomes stale, joining the regeneration worklist rather than spending
credits on the spot.

Getting that into the addon is one command and a commit:

```
make zones-lore-export        # rewrite addons/Spoken_Zones/Data/*.lua from the database
git diff addons/Spoken_Zones/Data/
make zones-lookup             # only if the text moved and the audio was regenerated
```

`make zones-lore-check` answers the other direction — whether the committed Lua still
matches the database.

A re-scrape never takes a hand edit back. `node tools/scrape.mjs` records what
the wiki says now as a new version, but a line whose live version was edited
keeps that edit; the wiki text waits in the history for someone to compare and
promote. That is what makes re-scraping safe to run.

`pipelines/zones/tools/seed/overrides.json` still exists and still wins over scraped text for
**zones**, keyed by uiMapID. It is the right place for lore that should survive a
rebuild of the database from a fresh scrape; the explorer is the right place for
everything else.

### Correcting uiMapIDs

`pipelines/zones/tools/seed/zones.json` was seeded from the known Classic Era uiMapID block
(947 Azeroth, 1414 Kalimdor, 1415 Eastern Kingdoms, 1411–1458 zones and cities).
To check it against your own client:

```
in-game:  /spz dump      then  /reload
here:     node tools/seed-from-dump.mjs           # report differences
          node tools/seed-from-dump.mjs --write   # rewrite the seed from the client
```

`/spz verify` does a lighter version of the same check entirely in-game.

## Verifying in-game

```
/console scriptErrors 1     surface Lua errors (do this first)
/spz                         status for the current zone and subzone
/spz verify                  check all 49 entries against this client
/spz panel                   toggle the world map panel
/spz options                 open the settings panel
/spz window                  open the browsable lore window
/spz play                    narrate the lore for where you are standing
/spz stop                    stop the narration
/spz voice                   turn narration on or off
/spz audio                   list sound packs, or switch with /spz audio <name>
/spz autoplay                toggle narrating areas as you discover them
/spz discover [area]         pretend to discover an area (dev)
/spz forget                  replay the login greeting on next login (dev)
/spz minimap                 show or hide the minimap button
/spz debug                   report area names on map click
/spz dump                    enumerate the map tree (dev)
```

Before logging in, `python3 tools/lua-syntax-check.py` balances block keywords and
delimiters across the addon's Lua. It is not a parser and cannot catch typos or
runtime errors, but a missing `end` otherwise costs a relog to find.

For subzones, `/spz debug` then clicking around a Tirisfal or Silverpine map prints
the raw area name, the key it normalised to, and whether lore was found — which is
how to spot a name that needs an alias. `/spz` on its own also reports the subzone
you are standing in via `GetSubZoneText()`, so mismatches can be found just by
walking around with the map closed.

Manual pass worth doing: open the map in a starting zone, walk across a zone
border with the map open, click up to the continent and back down, minimize and
maximize the map, then close and reopen it. The panel hides while the map is
maximized by design.

Also test with `Leatrix_Maps` both enabled and disabled — it manipulates the same
`WorldMapFrame`, and the map highlight draws on the same canvas.

## Releasing

Three CurseForge projects, released on their own cadences: most ZoneLore releases
do not touch a voiceline, and the packs should not re-upload 400MB for a Lua fix.

```sh
make zones-package                    # dist/Spoken_Zones-<version>.zip
make zones-package-audio              # dist/SpokenZonesAudio-<v>.zip
```

`make zones-package` refuses to build from a dirty `addons/Spoken_Zones/` tree, so a zip can always be
traced back to a commit. Both scripts unpack to the addon folder itself, which is
what the addon hosts expect — check with `unzip -l` if that ever seems in doubt.

**Versioning.** Both carry the same version, bumped together in their
`.toc`s. ZoneLore and a pack interoperate as long as their **major versions
match**; `PACK_FORMAT` in `Audio.lua` is the machine-checkable half of that rule
and is bumped only alongside a major.

**Per release:** bump the `.toc`s, add a `CHANGELOG.md` entry, commit, tag
`v<version>`, build, then upload:

```sh
make zones-release-dry                # what would be sent, sending nothing
make zones-release                    # both projects
./scripts/zones/release.sh zones      # or one at a time
```

`scripts/release.sh` posts to the CurseForge author API. It needs
`CURSEFORGE_TOKEN` in the repo root's `.env` — an account-wide token from
[the API tokens page](https://authors-old.curseforge.com/account/api-tokens),
not a per-project one, so one token covers all three.

The project IDs live in the script. Three things it derives rather than repeats:
the version comes from the `.toc` being uploaded, the zip is whatever
`package*.sh` named for that version, and the release notes are the matching
`## <version>` section of `CHANGELOG.md` — sent as markdown, so the notes on the
site cannot drift from the ones in the repository.

Game versions are resolved by **name** (`1.15.9` for Classic Era, `2.5.6` for the
Anniversary client) against `/api/game/versions` at upload time rather than being
hardcoded as the numeric IDs the API actually wants. Those IDs are undocumented,
and a wrong one produces a file filed against the wrong client, which players
experience as the addon not appearing in their AddOns list at all. A name that
matches anything other than exactly one version is fatal before any upload
happens. `GAME_VERSION_ERA=` and `GAME_VERSION_ANNIVERSARY=` override them.

Which clients each file is offered to is `target_game_versions()` in the script.
The addon and the VBR pack carry a `.toc` for both clients and are filed against
both; the sound pack is filed against Era alone, because the published zip
predates the second `.toc` and a file offered to a client it cannot load on is
worse than one that is simply absent there.

Uploads go out as CurseForge release type `release`, which is not the same claim
as the beta disclaimer in the descriptions: marking the files `beta` would stop
most addon managers offering them to players on the default channel, which is the
audience this is for. `RELEASE_TYPE=beta` overrides it.

### A language's sound pack

A page under `publishers/zones/` is what makes a language's pack exist at all —
`publishers/zones/spoken-zones-audio-esmx.md` for `esMX`. Its frontmatter (`curseforge:`,
`version:`, `slug:`, `name:`) is the CurseForge project, the version and the folder name
(`SpokenZonesAudio_esMX`) that every build and release script reads through
`scripts/lib/packs.mjs`, rather than a case a second language would add to. Add a language by
adding its page; nothing else names it.

`LOCALE=esMX` moves the whole chain to that language, and every step's build output lands
under `build/zones/esMX/` (never in English's `addons/SpokenZonesAudio/`, which stays
English's alone):

```sh
make zones-pull-live LOCALE=esMX      # this language's live takes, from the database
make zones-sounds LOCALE=esMX         # build/zones/esMX/Sounds, assembled from the archive
make zones-lookup LOCALE=esMX         # build/zones/esMX/Data/Sounds.lua
make zones-package-audio LOCALE=esMX  # dist/SpokenZonesAudio_esMX-<v>.zip
make zones-release-audio LOCALE=esMX  # uploads it, from ./scripts/zones/release.sh --lang=esMX
```

A language ships at the one `high`-tier quality every English pack ships at — its clips arrive
already at the bitrate they ship, so there is nothing to transcode. Its `.toc` says
`X-SpokenZones-Language: esMX`, so Spoken Zones plays it only under Spanish (AL) text, and it
installs beside the English pack rather than over it.

The pack numbers itself in its own page, from 2.0.0 so it starts level with the English pack
(Spanish (AL) shipped first, as 1.0.0), and its changelog sections are headed by
its release tag: `## <version> — zones-audio-esMX`. It has no Wago project — Wago refuses a
file this size — so its page has no `wago:`, and `./scripts/audio-github-release.sh zones esMX`
is where a Wago player finds it. Nothing under `build/` or `dist/` is committed, so after a
release there is nothing left to commit — a second language is a page, a release and nothing
else.

### Descriptions live in `publishers/`, and are pasted by hand

Neither store has **an API for project descriptions, summaries or categories** —
CurseForge offers `upload-file` and nothing else, and Wago's version endpoint is
the same shape. A project page is updated by pasting into a web form, so the only
question is where the pasted text comes from.

It comes from `publishers/<slug>.md`. The frontmatter is everything either form asks
for besides the body — a project id per store (`curseforge:` and `wago:`), summary,
categories, tags, license — and the body is the description. One body serves both
stores: `dist/descriptions/` is what CurseForge takes and `dist/descriptions-wago/`
the same text with its cross-links rewritten to Wago, because a link is only right
on the store it is read on. `scripts/descriptions.mjs` generates two things from it:

```sh
make zones-descriptions          # addon READMEs + dist/descriptions/ to paste from
make zones-descriptions-check     # part of `make zones-check`
```

The addon README that ships inside each zip is generated from the same body, so
the page a player reads before installing and the file they get afterwards cannot
say different things. Those READMEs are generated files and carry the usual
warning at the top; `make zones-check` fails if one has been edited by hand.

Nothing here can read the site back, so `publishers/published.json` records a hash
of each description at the moment it was pasted. `make zones-descriptions-published`
says "what is in the repository is now what is on the site" — run it *after*
pasting, since nothing can verify the claim. `scripts/release.sh` prints anything
that has drifted, at the one moment you already have the project pages open.

**What the script deliberately does not do** is create projects or set relations.
Those are one-time settings, and a script that rewrote them on every release would
be one that could quietly undo an edit made in the UI.

**Relations to set on each project once, by hand:** ZoneLore lists both packs as
optional dependencies; each pack lists ZoneLore as a required dependency; ZoneLore
lists LibStub, CallbackHandler-1.0, LibDataBroker-1.1 and LibDBIcon-1.0 as
includes, since they are embedded under `Libs/` rather than fetched.

## Licensing

Addon code: MIT.

`SoundQueue.lua`, `SoundUtils.lua`, `QueueEnv.lua`, `UI/SoundQueueUI.lua` and the
queue widget's textures are ported from
[VoiceOverRedux](https://github.com/rusty-key/wow-voiceover) and are MIT-licensed like the
rest of the repository. The credit is here because knowing where the code came from is
what makes re-applying its fixes possible.

Zone lore text in `addons/Spoken_Zones/Data/Zones.lua` and `Data/Subzones.lua` is
derived from [warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed
**CC BY-SA 4.0**; each entry carries a `source` URL to its page. The narration in
the sound packs is generated from that text and carries the same license. Any
distribution must keep that attribution and license the lore data and audio under
CC BY-SA. Text in `pipelines/zones/tools/seed/overrides.json` is original and not covered by that,
and so is any entry the data files emit with an empty `source` — a line rewritten
in the explorer keeps the source of the text it was derived from, because an edit
of wiki prose is still a derivative of it, so an empty `source` means the entry
has no wiki ancestor at all.

All three CurseForge projects declare **MIT** in the license dropdown, which is
the code half of that and the closest single entry the field offers. The wiki's
attribution and share-alike terms are carried in the description body instead —
every project page ends on a Credits section naming warcraft.wiki.gg and CC BY-SA
4.0, which is why those sections are not optional trimming when a page gets
rewritten.
