# Boss-lore translations

The website catalog is generated from `addons/Spoken_NPCs/Data/Stories.lua` and the localized
boss and dungeon names in the addon data:

```sh
node pipelines/places/tools/export-boss-lore-json.mjs
```

Optional prose translations live in one JSON file per locale. Each file maps the stable story
key `map:boss-key` to the translated paragraphs, for example:

```json
{
  "33:archmage arugal": "..."
}
```

The exporter keeps English as the source of truth and leaves a locale on its English fallback
until its file contains a translation. Names are already imported from the game's localized
boss data. When the client data needs a localized correction, keep it in
`pipelines/lib/boss-name-overrides.json`; `make bosses` applies those overrides to the addon
table before this catalog is exported. The override key is the stable `map:boss-key`.

For official localized Adventure Guide text, build a temporary localized source and import only
entries whose English text exactly matches the existing story:

```sh
node pipelines/places/tools/build-boss-stories.mjs \
  --out /tmp/boss-guide.lua --no-wiki
make boss-lore-guide GUIDE=/tmp/boss-guide.lua
make boss-lore
```

The exact-match rule prevents a shorter official description from being mislabeled as a
translation of a longer rewritten story.

To translate the complete English catalog, use the explicit network-enabled command below.
It protects boss and dungeon titles during translation and restores the localized names from
the addon data afterward:

```sh
make boss-lore-translate
make boss-lore
make boss-lore-check
make boss-lore-check COMPLETE=1  # require every non-English story
```
