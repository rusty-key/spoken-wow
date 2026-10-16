# AGENTS.md: Places

The root `AGENTS.md` applies, including its credit, data and versioning rules. This file covers
only the Places section, whose folders keep the name `zones`. Before changing a part, read its file:

- the module, its settings, languages and voice packs: [ADDON.md](ADDON.md)
- the Places tab, the map panel and the area and dungeon tables: [COMPENDIUM.md](COMPENDIUM.md)
- the story text: [LORE.md](LORE.md)
- the pictures: [PICTURES.md](PICTURES.md)
- voice, the site and releases: [VOICE.md](VOICE.md)
- adding content and finding gaps: [CONTENT.md](CONTENT.md)

## Generated files

Fix the source and regenerate. Never hand-edit the output.

- `addons/Spoken_Places/Data/<lang>/Zones.lua` and `Subzones.lua` come from the `lore_line` table.
  Edit lore through the site or re-scrape, run `make zones-lore-export`, and commit the diff.
  `make zones-lore-check` confirms the files match the database.
- `Data/<lang>/Aliases.lua` (`make zones-aliases`), `Data/Languages.lua` (`make zones-languages`),
  `Data/Pictures.lua` (`make zones-pictures`) and `Data/ForeverAreas.lua`
  (`make zones-forever-areas`) come from their own build tools. Run `make zones-languages` after
  a change to a translation or to the keys of `Locale/enUS.lua`.
- `addons/Spoken/Data/Dungeons.lua` comes from `pipelines/lib/dungeons.json` (`make dungeons`).
- `addons/SpokenZonesAudio/Data/Sounds.lua` is the pack's lookup table (`make zones-lookup`).
- `addons/SpokenZonesAudio/Sounds/` and `build/zones/<lang>/` are assembled by `make zones-sounds`
  from the live takes. They are not a store.

Kept by hand: `Data/AreaZones.lua`, `pipelines/zones/tools/seed/forever-places.json`,
`seed/zones.json`, `seed/subzones.json`, `seed/overrides.json` and
`pipelines/zones/tools/voice/pronunciation.json`.

`pipelines/zones/tools/voice/generate.mjs` reports on lines and cannot voice one. Keep it that
way: takes are cut on the site.

Line ids (`z:<mapID>`, `s:<mapID>:<key>`) and the keys in them are frozen once a story has one. A
renamed place keeps its key and gets an alias.

## Checks

```sh
make zones-check          # validate.mjs, the Lua block check and the locale check
make zones-validate-audio # manifest, files on disk and lookup table agree
make test-player          # the zones_*_test.lua suites among the rest
make lint                 # what CI gates on
```

## Packs and releases

- The `Spoken_Places` module ships inside Spoken and follows Spoken's version
  (see root `AGENTS.md`).
- `SpokenZonesAudio` versions on its own, and its notes go in `docs/places/CHANGELOG.md` under
  `## <version> — audio`. Language packs use `## <version> — zones-audio-<lang>`.
  `changelog_for()` in `scripts/zones/release.sh` matches on version and kind, and exits on a
  missing or duplicate section.
- Do not re-cut a pack for a change to the module alone. A pack upload takes hours.
- The addon accepts a pack whose `Sounds.lua` `version` equals `PACK_FORMAT` in
  `addons/Spoken_Places/Audio.lua`. That is a format number, unrelated to either `.toc` version.
  Bump it only when the pack's data shape changes.
- `make zones-full-release` chains sync, pull-live, package-audio and the upload, and asks
  before uploading.
- `scripts/zones/release.sh` uploads the English pack and the tombstone of the retired
  `SpokenZones` project, or one language's pack with `--lang`. Never add code to the tombstone.
