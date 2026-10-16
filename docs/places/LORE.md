# The story text

Every zone and area has a story of a few paragraphs. This file is how that text is built, where
it lives and how it is checked.

## Where the text lives

The `lore_line` table in the site's database is the corpus. A line has one row per version and
language, and the site shows and edits the current one. The Lua files under
`addons/Spoken_Places/Data/<locale>/` are an export of it, committed so that the addon builds on a
clone with no Postgres. Nothing on the site reads those files.

```
wiki.gg --scrape--> lore_line <--edit-- the site (apps/web, /zones)
                       |
        rewrite (Claude, costs credits)
                       |
         make zones-lore-export  -->  Data/<locale>/Zones.lua, Subzones.lua  (commit the diff)
```

`pipelines/zones/tools/lore/store.mjs` is the one place that decides between the database and the
files. With no `DATABASE_URL` the scrapers read and write the Lua files, and a run limited to one
zone (`--only`, `--zone`) leaves the files alone.

A row's `origin` says where the words came from:

| Origin | Meaning | Taken over by |
| --- | --- | --- |
| `scraped` | The wiki text. | A scrape, a rewrite or an edit. |
| `scraped-rewritten` | A Claude rewrite of the wiki article. | A rewrite or an edit, never a scrape. |
| `edited` | Written or corrected on the site. | Only another edit. A scrape or rewrite lands underneath as a version that is not live. |
| `translated` | Rows from an earlier translation upload, a tool that is gone. Text written on the site in another language is recorded as `edited`. | |
| `discovered` | A place the client has and nobody has written about. The text is empty. | An edit. |

Text that has not changed is not recorded again, so version numbers count changes. This is why
a re-scrape is safe to run: it never discards an edit.

## The files

`Data/<locale>/Zones.lua` is keyed by uiMapID. `Data/<locale>/Subzones.lua` is keyed by the parent
zone's uiMapID and then by the area's key. An entry has `name`, `short`, `full` and `source` (the
wiki page, or none where the text was written for this project). An entry with `pending = true` is a
place with no story yet: it ships with empty text so the addon can list it and say so. The
addon asks `SpokenZones:IsPending(entry)` and never tests for the entry's existence, because an
empty string is truthy in Lua.

The key of an area is its name made canonical: lower case, apostrophes dropped, a leading "the"
dropped, any other run of characters outside `a-z0-9` made one space. "The Bulwark" is `bulwark`.
Every language is keyed by the English name, because a place is one place whatever it is called.
`normaliseKey` in `pipelines/zones/tools/lib/wiki.mjs` and `SpokenZones:NormaliseAreaKey` in
`Core.lua` must agree, and `validate.mjs` checks that they do and that every generated key is
canonical (a key that is not is unreachable). A key is frozen once a story has one: when the
game renames a place, the key stays and `Data/ForeverAreas.lua` maps the new spelling to it.

Areas are looked up by name, because areas have no uiMapID. `C_Map.GetMapInfoAtPosition` returns
child maps only, and `MapUtil.FindBestAreaNameAtMouse` returns a name. `SpokenZones:ResolveAreaKey`
turns the name the client reports into a key: the alias table for the client's locale first, then
Forever's spelling, then the normalised name.

## Which places ship

Only places a client can report. `pipelines/zones/tools/seed/era-areas.json` and
`camelot-areas.json` are dumps of the client's own AreaTable (Era's and Forever's, at the builds
pinned in `pipelines/lib/wago.mjs`). `make zones-areas` fetches them again when a pin moves. The
export keeps a subzone only when its key is in one of the two, and drops Forever's second spelling
of a place the lore already keeps (`seed/forever-places.json`, kept by hand with a reason beside
each entry).

The English files also hold the pending places, so `validate.mjs` counts more entries for English
than for the other languages, which ship only the places that have text.

## Building the text

Seeds in `pipelines/zones/tools/seed/`:

| File | Holds |
| --- | --- |
| `zones.json` | uiMapID to the wiki page title. Check it against the client with `/spp verify`, or rebuild it from a dump with `/spp dump`, `/reload`, `node pipelines/zones/tools/seed-from-dump.mjs [--write]`. |
| `subzones.json` | Which parent zones to scrape areas for. Areas come from the wiki's `Category:<Zone> subzones`. `category` overrides the category name, `exclude` drops pages, `aliases` maps a client name to a wiki title. |
| `overrides.json` | Hand-written zone text that wins over the scrape. Empty at present. |

```sh
node pipelines/zones/tools/scrape.mjs [--refresh] [--only <uiMapID>] [--verbose]
node pipelines/zones/tools/scrape-subzones.mjs [--zone <uiMapID>] [--list <uiMapID>] [--refresh]
```

Both need Node 18 and no packages. They cache every API response in
`pipelines/zones/tools/cache/` (gitignored) and wait 500 ms between requests. `--no-classic` and
`--no-era-filter` turn off the two steps below.

- The wiki keeps `<Name> (Classic)` articles for places that changed after vanilla. They are
  preferred, and the `(Classic)` suffix never reaches the addon.
- A lead shorter than 300 characters for a zone, or 200 for an area, falls back to the article's
  lore sections.
- The era filter drops any sentence containing a post-vanilla term (`POST_VANILLA` in
  `lib/wiki.mjs`), by sentence because one clause about a later expansion should not cost the
  paragraph. `validate.mjs` carries its own list of forbidden terms and fails the build if one is
  in a shipped text.

### Rewriting with Claude

A lead alone misses the History section, where the older lore is, so `rewrite-lore.mjs` reads the
whole article and has Claude write it back as prose.

```sh
make zones-lore-rewrite ZONE=1420     # a dry run of both variants: writes a report to dist/
node pipelines/zones/tools/rewrite-lore.mjs --zone 1420 --variant a     # writes the corpus
```

Other flags: `--all`, `--variant a|b|both`, `--model`, `--refresh`, `--verbose`. It needs
`ANTHROPIC_API_KEY` in the root `.env` and spends credits, including with `--dry-run`, which is why
no scrape runs it. Responses are cached under `pipelines/zones/tools/cache/rewrite/` by model, prompt
version and source text.

- `lib/sections.mjs` picks the headings the model may see (History, Background, Description,
  Overview, Geography, Lore). Variant `a` puts the `(Classic)` lead in front of them, variant `b`
  uses them alone. The era filter runs before the model sees the text.
- Each line has a character budget from its own source: 85% of the source length, between 250
  and 1000. A thin article gives a short story.
- A rewrite that runs over budget is retried, and one that has post-vanilla text or a capitalised
  name found in no article in the run is reported and not written.

### Correcting a line

An editor rewrites it on the site (`/zones`, the edit control on a line). That records an `edited`
version, and the line becomes stale for the voice (see [VOICE.md](VOICE.md)). Bring it into the
addon with:

```sh
make zones-lore-export            # rewrites Data/<locale>/*.lua from the database
git diff addons/Spoken_Places/Data/
make zones-lookup                 # only if English text moved and the voice was cut again
make zones-lore-check             # does the committed Lua match the database?
```

`make zones-lore-import` seeds an empty table from the committed Lua, and does nothing to a table
that has rows.

## Languages

A language's stories are written on the site, in that language's rows of `lore_line`, never by a
tool here. The export writes a language's pair of files from the rows that have text, and only for
a line English ships with text.

- `Data/<locale>/Aliases.lua` turns the area name a client reports into an English key. It is
  keyed by the raw name, because normalising "Дун Морог" leaves nothing. `make zones-aliases`
  builds it from the AreaTable of Forever's build, then Era's, and also writes
  `seed/area-names.json`, every place's name in each language. Only locales a client runs in get a
  table. A name that is the same in both languages needs no alias.
- `make zones-lore-import-names LOCALE=deDE` puts those names into the site's `entity_name`
  table, so the site names a place as that client does.
- `Data/Languages.lua` (`make zones-languages`) counts per language the stories, the interface
  strings, the aliases and whether a voice pack page exists, and sets `ready`. Ready means every
  story is translated and, for a client language, an alias table exists. The addon offers only
  ready languages. Run `make zones-languages` after changing a translation or adding or removing
  a key in `Locale/enUS.lua`: `make zones-locale-check` and `make lint` fail while the file is
  stale.
- Each language needs its two data files, its aliases and its `Locale/<code>.lua` listed in
  `Spoken_Places.toc`. `validate.mjs` fails when a generated file is not listed.

## Checks

| Command | Fails when |
| --- | --- |
| `node pipelines/zones/tools/validate.mjs` | A data file is unbalanced or has a raw control character, a key is not canonical or is in no client's AreaTable seed, a story has post-vanilla text, an alias points at a missing key, the `.toc` lists the files in the wrong order or leaves one out, `Language.lua` and `lib/locales.mjs` differ, two areas in a zone share a report slug, or the Lua and JS key and slug code have drifted. It also prints how many area names each language's aliases reach. |
| `node pipelines/zones/tools/locale/check-strings.mjs` | Reports each language's interface string coverage. It never fails on an incomplete language. |
| `node pipelines/zones/tools/locale/build-languages.mjs --check` | `Data/Languages.lua` is out of date. |
| `make zones-lore-check` | The committed Lua differs from the database. Needs `DATABASE_URL`. |
| `tests/lua/locale_parity_test.lua` | A module's locale keys or format arguments differ from English. |

`make zones-check` runs the first three and the Lua block check.
