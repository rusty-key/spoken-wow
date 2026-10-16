# How the Places module works

## Spoken and the module

Spoken owns the player: the queue, the windows (Small Window, subtitles, DialogueUI window), the
minimap button and the settings. Places registers one source on it (`Spoken:RegisterSource("zones",
...)` in `Audio.lua`) with a queue limit of 3 waiting lines and a gap of 0.25 seconds between
clips. `docs/spoken/PLAYER-STYLES.md` describes the windows.

What Places adds to Spoken:

- A source, so its lines wait their turn behind the other modules'. Stop here stops Places lines
  only (`source:StopAll()`).
- A page in Spoken's settings (`UI/Options.lua`), under Spoken in the game's settings list.
- The Places tab of Azeroth's Compendium and a panel beside the world map ([COMPENDIUM.md](COMPENDIUM.md)).
- A Report button on each line being read. There is no Read button of its own.

The Enable switch on the Places page is Spoken's switch for the part (`Spoken:IsPartOn("zones")`).
With it off the map panel, its side tab and the Compendium tab go away.

## Settings

One page, Game Menu, Options, AddOns, Spoken, Places:

| Section | Setting | Saved as | Default |
| --- | --- | --- | --- |
| When to Read | Read Automatically | `autoplay` | on |
| | Include Smaller Areas | `autoplaySubzones` | on |
| | Include Places Found Before | `autoplayExplored` | off |
| Stories | Show Story Beside Map | `showMapPanel` | on |
| | Story Panel Width | `panelWidth` | 360 |
| | Show Pictures | `showPictures` | on |
| | Read Stories Aloud | `voiceEnabled` | on |
| | Text Language | `language` | Auto |
| Voice Packs | one row per language, Play a Test Line | | |
| Reading History | Forget Places Heard | | |

Defaults resets the settings in the table, the tab's two filters, the folded panel and the two
Developer settings. It leaves Text Language, the chosen voice pack, Unlock Undiscovered Places and
Text Size. Two Compendium settings are on Spoken's own page, in its Compendium section: Text Size (`Spoken:CompendiumFontSize()`, one size
for every tab and the map panel) and Unlock Undiscovered Places (`showUndiscovered`, off by
default). Spoken's Language section holds Voice Language and If a Voice Is Missing, and its While
Spoken Reads section holds Read in Battlegrounds. Under Spoken's Developer page are Places Debug
Messages (`debug`) and Offer Unfinished Translations (`languagePreview`).

Three settings have no row. `loreDiscoveredOnly` and `loreVoicedOnly` are the tab's filter menu,
`mapPanelCollapsed` is the panel's close button and side tab, and `audioPack` is `/spp audio`.

### Where they are saved

`SpokenZonesSettings` (saved variable) holds the settings. At load, `Spoken:BindModuleSettings`
swaps in the `Zones` table of Spoken's current profile (`Language.lua`, `Core.lua` `InitConfig`).
The first time, the old table is kept in Spoken's `global.ModulesLegacy`, and a profile with no
`Zones` table takes a copy of it at login, so every character has the values the account had.
Choosing another profile in Spoken, copying one over or resetting it rebinds the table, and a
profile made or reset then starts from the defaults. The `dump` key written by `/spp dump` is not
copied, and sits in the profile's table, which is also what `SpokenZonesSettings` is saved as. `SpokenZonesCharacter` (per character) holds
`greeted`, `heard` and `visited`.

`## LoadSavedVariablesFirst: true` is needed. The data files under `Data/` ask `Language.lua`
which language to build while they load, and it answers from the saved variable. Without the line
every player reads English and nothing errors.

## Three kinds of language

| Kind | Setting | What it decides |
| --- | --- | --- |
| Client locale | the game's own | The area names the game reports (so which `Data/<locale>/Aliases.lua` is used) and the interface strings (`Locale/<locale>.lua`, English where a key is missing). |
| Text language | Text Language, `/spp lang` | The words of the stories on the map panel, the Compendium and the lookup tables. |
| Voice language | Spoken's Voice Language | The voice pack that reads, and the words Spoken's windows and subtitles show for the line playing. |

Places follows Spoken's Voice Language and If a Voice Is Missing (`Audio.lua`, `GetVoiceLanguage`,
`GetFallbackLanguage`). Text Language changes the words only and takes effect after `/reload`,
because the data files for a language that was not active at load were never built.
Auto follows the client's language once that language is finished, English until then. Choosing
a language pins it on every client.

- A language is offered only when `Data/Languages.lua` marks it ready (every story translated, and
  an alias table where a client runs in it) and the client's fonts can draw it
  (`CanRenderLanguage`). Interface strings are not required, because each key falls back to English.
- Where a page sets a font file, `FontFor` picks the client's font for the script: `2002.TTF` for
  Korean, `ARKai_T.ttf` for Simplified Chinese, `blei00d.TTF` for Traditional Chinese and
  `FRIZQT___CYR.TTF` for Cyrillic.
- Text has no per-line fallback to English. A language is offered only once every story is
  translated, so a gap shows only in a preview. Audio does fall back, clip by clip: the active
  pack first, then the fallback language's packs, unless If a Voice Is Missing is Stay Silent.
- `/spp lang <code> force` and the Developer page's Offer Unfinished Translations show an
  unfinished language. Every login prints a warning while the override is on.
- Italian is in the list (`client = false`: no client runs in it) and has no data yet. The
  list in `Language.lua` must equal `pipelines/lib/locales.mjs`; `validate.mjs` checks it.

## How a story is read

`SpokenZones:NewLoreSound(mapID, areaKey)` builds the clip: its key is `z:<mapID>` for a zone and
`s:<mapID>:<key>` for an area (frozen, see the root `AGENTS.md`), the file and length from the
voice pack's lookup, and the `present` table Spoken's windows draw: header (the zone), label,
words (the story in the pack's language), a font where that script needs one, the zone badge,
the zone's icon as the face (Spoken's book without one), the place's picture and the Report action.

- Play on a page and `/spp play` use `PlayNow`: the story starts at once, ahead of the queue.
- A shift-click on a row in the Compendium queues the story behind what is playing (`QueueLore`),
  and does nothing for a place not yet found.
- Reading on discovery appends to the queue. A line with no clip in the installed pack is not
  queued, so it cannot take one of the three slots.
- Before a clip starts, Places' gate (`Autoplay.lua`, `HoldReason`) holds what reading on discovery
  queued while reading is off, in combat or during a cinematic. A held line waits and shows why.
  Play and shift-click lines are never held.
- A cinematic that starts after a clip has stops it, and it replays from the start when the
  cinematic ends.
- Reading on discovery queues nothing while the player is on a taxi or flying, and nothing for a
  continent.
- The client can start and stop a sound file and nothing in between. Stop and Replay exist, Pause
  does not.
- With nothing installed that plays a place, Play prints why: no voice pack, or a pack without
  that story.

### Read in Battlegrounds

Spoken's Read in Battlegrounds (on by default) decides whether lines nobody asked for are read in
battlegrounds and arenas. Off, `Sources:Enqueue` refuses them, which covers reading on discovery,
the login greeting and the already-found sweep, and it clears what was already queued. Play and a
shift-click still read there.

## Voice packs

A pack is an addon folder with `Data/Sounds.lua`, which registers itself in
`SpokenZonesAudioPacks[<folder>]`. The addon also reads `ZoneLoreAudioPacks` and
`ZoneLoreAudioData`, which packs published before the rename write to.

- `Sounds.lua` has `version = 1`. `PACK_FORMAT` in `Audio.lua` is 1. A pack with another number
  is skipped with a message in chat, because guessing at an unknown layout plays silence and says
  nothing. Bump `PACK_FORMAT` only when the pack's data shape changes.
- The pack reads its folder name, `X-SpokenZones-Quality`, `X-SpokenZones-Bitrate`,
  `X-SpokenZones-Language` and `Version` from its `.toc`, so one generated `Sounds.lua` serves
  every pack. A pack with no language key is English.
- The pack that reads is the best one in the voice language, else the best in the fallback
  language. Between two packs of one language, `/spp audio <folder>` chooses (stored per language
  as a folder name), else the higher bitrate.
- Durations come from the lookup, because the client cannot report how long a file is. Spoken's
  queue needs them to know when a clip has ended.
- No clip stands in for a missing one. A quest line used to, and players reported the lore as
  wrong.

Spoken's page lists one row per language: the version where the pack is installed, and a button
with its address where it is not (`Spoken:VoicePack` in `addons/Spoken/API.lua`, kept in step with the
store pages by `tests/lua/packs_test.lua`).

## Reading on discovery

The game announces a discovery once per character, and Places reads that message
(`Autoplay.lua`).

- The patterns are built at run time from the client's own `ERR_ZONE_EXPLORED_XP` and
  `ERR_ZONE_EXPLORED`, so every client locale works. Four events are watched
  (`CHAT_MSG_SYSTEM`, `CHAT_MSG_COMBAT_XP_GAIN`, `UI_INFO_MESSAGE`, `UI_ERROR_MESSAGE`), and the
  handler takes whichever argument is a string. `/spp` says how many message forms the client
  defines.
- An area with the zone's name is a zone discovery. Any other is an area, read only with Include
  Smaller Areas on.
- A discovery happens once ever, so re-entering an explored area proves nothing. `/spp discover
  [area]` runs the same path, and `/spp debug` prints every message on the four events.
- The login greeting. A new character's spawn area is announced before the map is settled, so
  two seconds after login a greeting reads it instead, up to eight tries, only for a level 1
  character standing in one of the six starting areas (`STARTING_AREAS`). `greeted` in
  `SpokenZonesCharacter` makes it happen once, and `/spp forget` clears it.
- Include Places Found Before also reads on zone change, once per place, for a character that
  explored before installing. `heard` records places when a clip starts, not when it is queued.
- The queue refuses a duplicate of a line already queued or playing.

## Reports and contributions

The game cannot open a link, so a Report button shows an address to copy
(`UI/CopyLink.lua`). `SpokenZones:ReportURL` builds it with `Spoken:ReportURL`:
`https://spoken.rusty.one/zones/r/<mapID>/<slug>` for English and
`https://spoken.rusty.one/<lang>/zones/r/<mapID>/<slug>` for another language. The language is
the one the clip is read in for Report on the player's window, and the text language for
Report on a page. The slug is the key with spaces as hyphens and other
characters dropped, and `zone` for a zone. `validate.mjs` fails the build if the Lua slug and
`slugFor` in `pipelines/zones/tools/voice/naming.mjs` disagree, or two areas in a zone share one.

A place with no story shows Contribute under the sentence saying so. It sends the place the page
shows, not where the player stands: the addon version, build, locale, the pack's language, the map,
the zone and the area (`Contribute.lua`), through `Spoken.Contribute:Envelope("zones", ...)` to
`/contribute` on the site. The page asks for a description of at least 20 characters
(`DESCRIPTION_MIN` in `apps/web/src/lib/contributions/contributions.ts`). Spoken's Hide Report
Buttons and Hide Contribute Buttons settings hide both.

## Checks for this part

`tests/lua/zones_*_test.lua`, run by `make test-player`. They cover the source and its queue, language,
options, the greeting, discovery, the tab, the map click and highlight, areas, dungeons, cities,
Forever-only places and contributions.
