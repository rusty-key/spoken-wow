# Places

Places is the part of Spoken that tells the story of every zone and area in the game. The story
sits beside the world map and in the Places tab of Azeroth's Compendium, and Spoken reads it aloud
when a voice pack is installed. The module is `addons/Spoken_Places`. It needs Spoken
(`## Dependencies: Spoken`) and ships in Spoken's zip.

The stories come from warcraft.wiki.gg, rewritten by Claude into short prose and corrected by
hand on the site. They are bundled in the addon in English and nine other languages. Nothing is
fetched while playing.

Forever (Interface 16001) is the client this is built for. The `.toc` still lists 11509 (Classic
Era) and 20506 (Anniversary), and the code still runs there, but no new work is done for them.

## Reading order

| File | What it covers |
| --- | --- |
| [ADDON.md](ADDON.md) | Settings, languages, how a story is read, the voice packs, reading on discovery |
| [COMPENDIUM.md](COMPENDIUM.md) | The Places tab, undiscovered places, the dungeon and area tables, the map panel |
| [LORE.md](LORE.md) | How the story text is built, stored, exported and checked |
| [BOSSES.md](BOSSES.md) | The boss tables behind Spoken_Bosses and the Lua exported from them |
| [PICTURES.md](PICTURES.md) | The place pictures and their edge masks |
| [VOICE.md](VOICE.md) | Voice, the site, the voice packs, releases |
| [CONTENT.md](CONTENT.md) | Adding a place, a dungeon, a picture or a language, and finding what is missing |
| [AGENTS.md](AGENTS.md) | Rules for changing this section |
| [CHANGELOG.md](CHANGELOG.md) | Release notes for the voice packs |

The notes for the module itself are in `docs/spoken/CHANGELOG.md`, because it versions with Spoken.

## What ships

| Folder | What it is |
| --- | --- |
| `addons/Spoken_Places` | The module: stories, lookup code, the map panel, the Places tab, settings page. |
| `addons/SpokenPlacesAudio` | The English voice pack. The repository holds `Data/Sounds.lua` (the clip lookup) and the `.toc`; the mp3s in `Sounds/` are gitignored and assembled from the site's takes. |
| `SpokenPlacesAudio_<locale>` | One pack per other language. Built into `build/places/<locale>`, never committed. |

The addon still reads the packs that were published as `ZoneLoreAudio` and `ZoneLoreAudio64`
(`Audio.lua`, `GetAudioPacks`), because those folders are on players' disks.

## Layout

```
addons/Spoken_Places/
  Spoken_Places.toc       load order; LoadSavedVariablesFirst is needed by Language.lua
  Language.lua           client locale, text language, fonts, interface strings, data registration
  Core.lua               settings, zone and area lookup, report links, the area and dungeon indexes, /spp
  Audio.lua              the Places source on Spoken's player, voice pack selection, clip lookup
  Autoplay.lua           reading a place when the game announces its discovery, the login greeting
  Discovery.lua          which places this character has found
  Contribute.lua         the envelope for a place with no story
  Data/<locale>/Zones.lua, Subzones.lua   the stories (generated)
  Data/<locale>/Aliases.lua               the client's area names back to English keys (generated)
  Data/Languages.lua     which languages are finished (generated)
  Data/Pictures.lua      which picture and edge mask each place has (generated)
  Data/ForeverAreas.lua  places only Forever has or names differently (generated)
  Data/AreaZones.lua     areas listed under another zone than their story's (by hand)
  Locale/<locale>.lua    interface strings; enUS.lua is the key set
  Textures/Pictures/     the place pictures, 32 edge masks and CREDITS.md
  Textures/Art/          the spellbook and quest log art the page is drawn with
  UI/                    LoreWindow (the tab), LorePage, MapPanel, SubzoneClick, MapHighlight,
                         Options, CopyLink
addons/Spoken/UI/        Compendium.lua, TextView.lua, Face.lua: shared with the other modules
addons/Spoken/Data/Dungeons.lua   the dungeon and raid table every tab reads (generated)
pipelines/places/tools/   scrapers, the lore store and exporter, locale tools, pictures, voice
pipelines/lib/dungeons.json   the dungeon table's source
scripts/places/           package.sh, package-audio.sh, release.sh
make/places.mk            the make places-* targets
publishers/places/         the store pages for the packs
apps/web                  the site, with the lore explorer at /places
tests/lua/places_*_test.lua
```

## Commands

`/spokenplaces` or `/spp`. A bare `/spp` prints the status of the current zone and area. The old
`/spokenzones` and `/spz` still work, for macros.

| Command | What it does |
| --- | --- |
| `/spp settings` | Open the Places page of the settings (`options`, `config` and `opt` work too). |
| `/spp window` | Open the Places tab of Azeroth's Compendium (`w` and `compendium` work too). |
| `/spp panel` | Turn Show Story Beside Map on or off. |
| `/spp play` | Read the story of where you stand: the area if it has one, else the zone. |
| `/spp stop` | Stop reading place stories. Other modules' lines keep playing. |
| `/spp voice` | Turn Read Stories Aloud on or off. |
| `/spp autoplay` | Turn Read Automatically on or off. |
| `/spp audio [folder]` | List the installed voice packs, or choose one by folder name. |
| `/spp lang [code]` | List the text languages, or switch to one. `auto` follows the client. `<code> force` and `off` preview unfinished languages. |
| `/spp forget` | Forget the places this character has heard and the login greeting. |
| `/spp diagnostics` | The Places part of Show Diagnostics on Spoken's page: voice packs and how reading is set up. |
| `/spp help` | List the player commands. |
| `/spp discover [area]` | Pretend to discover an area. For testing. |
| `/spp found` | List every place counted as found, and why. |
| `/spp debug` | Print area names, keys and discovery messages while you play. |
| `/spp verify` | Check every zone map in the data against this client. |
| `/spp dump` | Write the map tree into the saved variables. `/reload`, then `node pipelines/places/tools/seed-from-dump.mjs`. |

`/sp` is Spoken's own command. `/sp compendium` opens Azeroth's Compendium, `/sp stopall` stops
every module, and `/sp diagnostics` prints Spoken's state followed by each module's.

## Checks

```sh
make places-check            # validate.mjs, the Lua block check and the locale check
make places-validate-audio   # manifest, files on disk and the lookup table agree
make test-player            # every addon Lua test, the zones_*_test.lua ones included (needs luajit)
make lint                   # what CI gates on
```

`make places-check` and `make lint` run `pipelines/places/tools/locale/build-languages.mjs --check`,
which fails while `Data/Languages.lua` is out of date. The Lua block check
(`pipelines/places/tools/lua-syntax-check.py`) needs Python.

## Running the checkout in the game

`/link-addon` (the skill in `.claude/skills/link-addon`) links the worktree's addons into the
client's `Interface/AddOns`. `/reload` then runs the checkout's code. A texture the game did not
list at start draws solid green until the client restarts, so a new picture needs a restart and
not only `/reload`. `scripts/places/deploy.sh` is older: it installs into Classic Era and
Anniversary folders only.

## License

Addon code is MIT. The story text is derived from warcraft.wiki.gg and licensed CC BY-SA 4.0:
each entry carries a `source` URL, and an entry with an empty `source` was written for this
project. The voice generated from that text carries the same license, so any distribution
keeps the attribution. Every store page ends with a Credits section naming warcraft.wiki.gg and
CC BY-SA 4.0, and that section stays when a page is rewritten. The pictures are credited in
`addons/Spoken_Places/Textures/Pictures/CREDITS.md` and `THIRD_PARTY.md`.
