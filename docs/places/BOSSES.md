# Boss data

The dungeon and raid bosses of Spoken_Bosses: which instances and bosses exist, their names in
every language, their creature and model, and their stories. This file is where that data lives,
how the tools write it and how it is checked.

## Where the data lives

Three tables in the site's database are the source: `boss_instance` (one row per instance map),
`boss` (one row per boss) and `boss_line` (one row per boss, language and version, holding the
story). Boss and instance names are rows of `entity_name`, kind `boss` (the boss id as text) and
`instance` (the map as text). The three Lua files under `addons/Spoken_Bosses/Data/` are an export of
them, committed so that the addon builds on a clone with no Postgres.

```
client tables --make bosses-extract--> boss_instance, boss, entity_name
write-boss-creatures.mjs -------------> boss (creatureId, displayId)
apply-boss-stories.mjs ---------------> boss_line
   ^ [{ map, key, lang?, text }] JSON: rewritten stories, or assemble-boss-stories.mjs' output
the site (/bosses) -------------------> boss_line, entity_name (boss names), take
                                           |
                    make bosses-export --> Data/Bosses.lua, Creatures.lua, Stories.lua  (commit the diff)
```

`pipelines/places/tools/bosses/store.mjs` is the one place that reads and writes these tables.
There is no file fallback: a tool that writes boss data fails with a message when `DATABASE_URL`
is unset and never writes Lua. `bosses/reconcile.mjs` decides which rows the client's encounter
list means, `bosses/shape.mjs` turns rows into what the three files hold, and `bosses/export.mjs`
writes them.

`build-boss-stories.mjs` and `assemble-boss-stories.mjs` gather source text and never write under
`addons/`: they write to `build/boss-stories/` (gitignored) by default and refuse an `--out` under
`addons/`. Their stories reach the addon only through `apply-boss-stories.mjs` and the export.

## Stories in every language

`boss_line` has no reference from one language's row to another's, and nothing asks whether
English has text before returning a German story. A language's story exists whether English has
one or not, and the export ships every language that has a current row.

`Stories.lua` carries all languages in one file. A boss with English only is a string. A boss with
more is a table, `{ "English", deDE = "..." }`. A boss with a story in another language and none in
English is `{ deDE = "..." }`.

## Origins

| Origin | Meaning | Taken over by |
| --- | --- | --- |
| `rewritten` | Text a tool wrote (`apply-boss-stories.mjs`). | A rewrite or an edit. |
| `edited` | Written or corrected by a person. | Only another edit. A tool write lands underneath as a version that is not live. |

Names have their own two origins: `extracted`, written from the client's tables by `make bosses-extract`,
and `edited`, changed on the site. They follow the `entity_name` rules: an unchanged name records
nothing, a changed game name replaces an extracted one, and an edited current name stays current.
A boss newly added to `pipelines/lib/boss-names.json` takes its creature's names where the
database has them; a language its creature has no name in keeps the name already recorded for the
encounter until someone edits it. Text that has not changed is
not recorded again, so version numbers count changes. A second run of a tool on a database where
someone has since edited a story changes nothing.

## Matching and retiring

A boss is identified by its instance map and `key`. The pipelines match a boss by its encounter
id, never by key and never by English text. `boss.id` is the primary encounter id and
`boss.encounterIds` holds every id that stands for the same boss (difficulties, versions).

The key is minted from the English name when a boss first appears and is frozen after that. When
the game renames a boss, its encounter id is the same: the row keeps its key and its stories and
only the extracted names move. A key is the one in `Stories.lua[map][key]`, so renaming it would
orphan the story.

A boss the client no longer lists, or one in `UNCONFIRMED` (`pipelines/lib/bosses.mjs`), gets
`retired = true`. It is never deleted, so its stories survive, and the export leaves it out.

## Which database

Production is upstream, as for every section's corpus. Run a tool that writes boss data against
it with the variable set inline, never exported:

```sh
DATABASE_URL=$PROD_DATABASE_URL node pipelines/places/tools/apply-boss-stories.mjs <dir>
make bosses-sync     # replaces the local boss tables, boss names and boss takes with the droplet's
make bosses-export
make bosses-check
```

`make bosses-sync` is destructive; confirm before running it. It goes through
`scripts/db/sync-section.sh bosses`, which also brings the `take`, `recording` and `take_ack` rows
with source `bosses`, and `make bosses-check-synced` compares the local data with the
droplet's through `scripts/db/check-synced.sh bosses`, using the digest in
`deploy/web/sql/bosses_stamp.sql` because the boss tables have no serial id to stamp.

The tables were seeded from the committed Lua by a one-off intake, kept outside this repository
(`import-boss-lore.mts`, run from `apps/web` with `npx tsx`). It is not part of the build.

## The site

`/bosses` lists every live boss under its instance, in the order the addon's Bosses tab uses, and
is built from the places explorer with a bosses section config (`components/bosses/sections.ts`).
It reads `boss_instance`, `boss`, `boss_line` and `entity_name` and nothing else (`lib/bosses/`).

- A language's page shows that language's current story or says "No story in this language yet."
  English text never stands in for it. A boss with no story has no play or regenerate button, but
  a translator can write one.
- Edits record an `edited` version of `boss_line`, with the places permissions: an editor or a
  translator for the language edits, editors and above regenerate. Off English, the same people
  name a boss in the language through `/api/names` (kind `boss`, the boss id), an `edited` row of
  `entity_name`.
- Each row shows the map, the encounter id(s) and, where there is one, the creature id with a
  Wowhead link.
- Regenerating cuts a take with the language's narrator through `lib/generation/narrated.ts`. The
  take's line id is `boss:{map}:{key}`, the addon's clip key, and its file is `{map}/{slug}` from
  `assignFiles` in `pipelines/places/tools/voice/naming.mjs`. The take archive is
  `SPOKEN_BOSSES_AUDIO_HISTORY`.
- `/bosses/r/{map}/{slug}` is the report page for one boss. Reports land under the Bosses tab of
  `/reports`. Bosses take no contributions.
- With no boss rows the page says the intake has not been run.

## Voice and the pack

A boss's story is read aloud from `SpokenBossesAudio`, a sound pack built as the places pack is
([VOICE.md](VOICE.md)): `addons/SpokenBossesAudio` for English, `SpokenBossesAudio_<lang>` for the
others (`languageFolder` in `scripts/lib/packs.mjs`). The takes are cut on `/bosses`, with
`source = 'bosses'`, and live in `SPOKEN_BOSSES_AUDIO_HISTORY` (droplet `shared/audio-history/bosses`).

```sh
make bosses-pull-live       # fetch the live takes the local database names
make bosses-sounds          # assemble Sounds/ from them (LOCALE=xx for a language)
make bosses-lookup          # build Data/Sounds.lua (pipelines/places/tools/bosses/build-lookup.mjs)
make bosses-validate-audio  # lookup, files and stories agree (validate-audio.mjs); a stale take is reported
make bosses-package-audio   # check-synced, sounds, lookup, validate, then zip into dist/
make bosses-full-release    # sync, pull, build, then the GitHub release, with one question first
```

- The lookup key is `boss:{map}:{key}` and the file `{map}\{slug}`, from the same `assignFiles` the
  site uses, so the pack and the site cannot disagree on a file.
- The pack's page is `publishers/bosses/spoken-bosses-audio.md` and its changelog
  `docs/bosses/CHANGELOG.md`. `MIN_SPOKEN.bosses` is 3.7.0. The page gets `manager: true` in the
  pack's first release: `make manager-publish` checks every manager pack is built and its Spoken
  released, so an unreleased one would block the other sections.
- Where the English pack is published:
  - **CurseForge** has no bosses project. The page says `bundledIn: spoken-audio-places`, and
    `make places-package-audio` builds a second English zip, `SpokenPlacesAndBossesAudio-<v>.zip`,
    holding the built `dist/SpokenBossesAudio` beside `SpokenPlacesAudio`. That bundle is what
    Spoken Audio: Places and Bosses is sent. Packaging refuses a missing or stale bosses build,
    and the upload refuses a bundle whose bosses `.toc` version or `Data/Sounds.lua` is not the
    repo's.
  - **GitHub**: `places-audio` holds the plain `SpokenPlacesAudio-<v>.zip`, Places only, and
    `bosses-audio` holds the bosses pack (`make bosses-full-release` or
    `make audio-release SECTION=bosses`). Wago players get both from there.
  - **The manager** keeps the two as separate products. It refuses a zip holding a folder its
    product does not own, which is why GitHub's places zip never carries the bosses.
- **Ship a bosses change in the same run as a Places release.** A bosses change reaches CurseForge
  only inside a Places release, so cut the bosses release (`make bosses-full-release`) together with
  an English `make places-full-release`, which syncs, pulls and builds the bosses pack first. That
  keeps the bosses on CurseForge at the version the manager and GitHub offer. Only English's
  Places pack carries it.
- `Spoken_Bosses` ranks the installed packs (`Audio.lua`, [../bosses/README.md](../bosses/README.md)). A
  story with no clip shows as words only; a voiced one plays like any other voiced line.

## Commands

```sh
make bosses-extract  # bring boss_instance, boss and the names into step with the client
node pipelines/lib/bosses.mjs --check   # list what the client would change; fails if anything
node pipelines/places/tools/write-boss-creatures.mjs <boss_creatures.json>
node pipelines/places/tools/apply-boss-stories.mjs <dir of *.json>   # { map, key, lang?, text }, lang enUS if left out
make bosses-export   # write Bosses.lua, Creatures.lua and Stories.lua from the database
make bosses-check    # do the committed files match the database?
make bosses-sync     # replace the local boss tables and boss takes/recordings/acks with the droplet's (DESTRUCTIVE)
make bosses-check-synced
```

The tools that write boss data need `DATABASE_URL`, and so do `node pipelines/lib/bosses.mjs
--check` and `make bosses-check`, which read the tables. `make bosses-extract` writes the tables and not
`Bosses.lua`; run `make bosses-export` after it. `write-boss-creatures.mjs` sets every live boss, to
null where nothing gives it a creature. `Creatures.lua` keeps its `\r\n` line endings.

## Checks

| Command | Fails when |
| --- | --- |
| `make bosses-check` | A committed file differs from the database. It ignores each file's leading comment lines and line endings. Needs `DATABASE_URL`. |
| `node pipelines/lib/bosses.mjs --check` | The client's encounter table would change the boss tables. Needs `DATABASE_URL`. |
| `pnpm --filter @spoken/places-pipeline test` | Reconciling, shaping or exporting changes behaviour. |
| `make test-player` | `tests/lua/bosses_test.lua` and the rest of the addon's Lua tests fail. |

`make bosses-check` is not part of `make check` or `make lint`, which have to pass on a clone with no
Postgres.
