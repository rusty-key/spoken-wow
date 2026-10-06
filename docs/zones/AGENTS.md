# AGENTS.md: zones

The root `AGENTS.md` applies, including its credit, data and versioning rules. This file covers
only the zones section. `docs/zones/README.md` is the detailed reference.

## Generated files

Fix the source and regenerate. Never hand-edit the output.

- `addons/Spoken_Zones/Data/<lang>/*.lua` comes from the `lore_line` table. Edit lore through
  the site or re-scrape, run `make zones-lore-export`, and commit the diff.
  `make zones-lore-check` confirms the files match the database.
- `addons/Spoken_Zones/Data/Languages.lua` and `Data/Pictures.lua` come from their own build
  tools.
- `addons/SpokenZonesAudio/Data/Sounds.lua` is the pack's lookup table.
- `addons/SpokenZonesAudio/Sounds/` (enUS) and `build/zones/<lang>/` are assembled by
  `make zones-sounds` from the live takes. They are not a store.

`pipelines/zones/tools/generate.mjs` reports on lines and cannot voice one. Keep it that way.

## Checks

```sh
make zones-check          # validate + lint + locale-check, the pre-package gate
make zones-validate-audio # manifest, files on disk and lookup table agree
```

## Packs and releases

- The `Spoken_Zones` module ships inside Spoken and follows Spoken's version
  (see root `AGENTS.md`).
- `SpokenZonesAudio` versions on its own, and its notes go in `docs/zones/CHANGELOG.md` under
  `## <version> — audio`. Language packs use `## <version> — zones-audio-<lang>`.
  `changelog_for()` in `scripts/zones/release.sh` matches on version and kind, and exits on a
  missing or duplicate section.
- Do not re-cut a pack for an addon-only change. A pack upload takes hours.
- The addon accepts a pack whose `Sounds.lua` `version` equals `PACK_FORMAT` in
  `addons/Spoken_Zones/Audio.lua`. That is a format number, unrelated to either `.toc` version.
  Bump it only when the pack's data shape changes.
- `make zones-full-release` chains sync, pull-live, package-audio and the upload, and asks
  before uploading. `scripts/zones/release.sh` now uploads only the pack and the retired
  SpokenZones project's tombstone.
