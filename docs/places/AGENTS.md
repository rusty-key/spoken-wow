# AGENTS.md: Places

The root `AGENTS.md` applies, including its credit, data and versioning rules. This file covers
only the Places section, which was keyed zones until 2026-10. Everything says places now but the
`z:`/`s:` line ids (frozen), the retired `spoken-zones` CurseForge project and the history. What
players already have under the old names is still read: `SpokenZonesSettings` and
`SpokenZonesCharacter` are carried over once, packs released as `SpokenZonesAudio*` (writing
`SpokenZonesAudioPacks`, `X-SpokenZones-*`) still play until their `SpokenPlacesAudio*` replacement
is installed, the site redirects `/zones` and reads `!SPOKEN1 zones` envelopes, and the manager
counts `zones-audio*` releases as the packs'.
Before changing a part, read its file:

- the module, its settings, languages and voice packs: [ADDON.md](ADDON.md)
- the Places tab, the map panel and the area and dungeon tables: [COMPENDIUM.md](COMPENDIUM.md)
- the story text: [LORE.md](LORE.md)
- the pictures: [PICTURES.md](PICTURES.md)
- voice, the site and releases: [VOICE.md](VOICE.md)
- adding content and finding gaps: [CONTENT.md](CONTENT.md)
- the boss tables behind Spoken_Bosses: [BOSSES.md](BOSSES.md)

## Generated files

Fix the source and regenerate. Never hand-edit the output.

- `addons/Spoken_Places/Data/<lang>/Zones.lua` and `Subzones.lua` come from the `lore_line` table.
  Edit lore through the site or re-scrape, run `make places-lore-export`, and commit the diff.
  `make places-lore-check` confirms the files match the database.
- `Data/<lang>/Aliases.lua` (`make places-aliases`), `Data/Languages.lua` (`make places-languages`),
  `Data/Pictures.lua` (`make places-pictures`) and `Data/ForeverAreas.lua`
  (`make places-forever-areas`) come from their own build tools. Run `make places-languages` after
  a change to a translation or to the keys of `Locale/enUS.lua`.
- `addons/Spoken/Data/Dungeons.lua` comes from `pipelines/lib/dungeons.json` (`make dungeons`).
- `addons/SpokenPlacesAudio/Data/Sounds.lua` is the pack's lookup table (`make places-lookup`).
- `addons/SpokenPlacesAudio/Sounds/` and `build/places/<lang>/` are assembled by `make places-sounds`
  from the live takes. They are not a store.

Kept by hand: `Data/AreaZones.lua`, `pipelines/places/tools/seed/forever-places.json`,
`seed/zones.json`, `seed/subzones.json`, `seed/overrides.json` and
`pipelines/places/tools/voice/pronunciation.json`.

`pipelines/places/tools/voice/generate.mjs` reports on lines and cannot voice one. Keep it that
way: takes are cut on the site.

`addons/Spoken_Bosses/Data/Bosses.lua`, `Creatures.lua` and `Stories.lua` come from the `boss_instance`,
`boss` and `boss_line` tables and the boss names in `entity_name`. The tables are the corpus and
the Lua is an export (`make bosses-export`, checked by `make bosses-check`). Match a boss by its
encounter id and never key on English text; keys are frozen, and a boss the client drops is
retired, not deleted. See [BOSSES.md](BOSSES.md).

Line ids (`z:<mapID>`, `s:<mapID>:<key>`) and the keys in them are frozen once a story has one. A
renamed place keeps its key and gets an alias.

## Checks

```sh
make places-check          # validate.mjs, the Lua block check and the locale check
make places-validate-audio # manifest, files on disk and lookup table agree
make test-player          # the zones_*_test.lua suites among the rest
make lint                 # what CI gates on
```

## Packs and releases

- The `Spoken_Places` module ships inside Spoken and follows Spoken's version
  (see root `AGENTS.md`).
- `SpokenPlacesAudio` versions on its own, and its notes go in `docs/places/CHANGELOG.md` under
  `## <version> — audio`. Language packs use `## <version> — places-audio-<lang>`.
  `changelog_for()` in `scripts/places/release.sh` matches on version and kind, and exits on a
  missing or duplicate section.
- Do not re-cut a pack for a change to the module alone. A pack upload takes hours.
- The addon accepts a pack whose `Sounds.lua` `version` equals `PACK_FORMAT` in
  `addons/Spoken_Places/Audio.lua`. That is a format number, unrelated to either `.toc` version.
  Bump it only when the pack's data shape changes.
- `make places-full-release` chains sync, pull-live, package-audio and the upload, and asks
  before uploading. English's CurseForge zip also carries the bosses pack (Spoken Audio: Places
  and Bosses), so an English run builds that first; GitHub's stays Places only. See
  [VOICE.md](VOICE.md).
- `scripts/places/release.sh` uploads the English pack, or one language's pack with `--lang`.
