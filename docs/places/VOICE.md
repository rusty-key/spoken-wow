# Voice, the site and the voice packs

Place stories are read aloud from voice packs: addons that hold the voice of each story and a
table that says which file is which. The takes are cut on the site. The tools in this
repository report on lines, build the tables and package the packs. None of them can spend
credits.

## Where each part happens

| Step | Where |
| --- | --- |
| Write or correct the text | The site, `/zones` (apps/web). See [LORE.md](LORE.md). |
| Cut a take of a line | The site, on the droplet. One queue and one lock per line, with the signed-in editor's own key. |
| Record what exists | The `take` table. `pipelines/zones/tools/voice/manifest.json` is an export of it, committed so that a clone with no Postgres can build and review. |
| Report, build the lookup, check it | This repository, `make zones-*`. |
| Assemble and package a pack | This repository, from the live takes and the archive. |
| Upload | `scripts/zones/release.sh`, CurseForge, and GitHub for the packs. |

A take is one mp3 in the archive, written once and never changed. Which take is live is a flag on
its row, so a new take cannot overwrite an old one, and a pack's `Sounds/` folder is not kept: it
is assembled from the live rows right before packaging.

## Generating voicelines

`generate.mjs` selects lines and reports. It writes nothing and calls no service.

```sh
make zones-voice                                              # every line: counts, characters, credits, minutes
make zones-voice-zones                                        # the zone lines only
node pipelines/zones/tools/voice/generate.mjs --missing --stale --list
node pipelines/zones/tools/voice/generate.mjs --zone Durotar --limit 20
```

Selectors: `--zone <id|name>` (repeatable; a zone selects its areas too), `--zones-only`,
`--subzones-only`, `--missing` (no audio yet), `--stale` (the spoken text changed since the take
was cut), `--dictionary-drift` (cut with another pronunciation dictionary than the one in use;
needs `DATABASE_URL`), `--older-than <date>`, `--all`, `--limit <n>` and `--list`. The credit
estimate uses the rate measured from the manifest, and falls back to `creditRate` in
`pipelines/zones/tools/voice/config.json`, the only thing that file holds.

To cut a take, open the line on the site's Zones page and generate it there. Editing a line's text
makes its take stale.

### The spoken text

What is said is the display text through `toSpokenText` (`normalise.mjs`). No square bracket may
reach the voice model, which reads one as a direction to act. A bracketed pronunciation guide,
level range or coordinate is dropped, and a bracketed name keeps its words. Paragraph breaks
become a space, and parentheses are removed with their words kept. `validate-audio.mjs` fails
when a line still has a bracket. `pronunciation.json` holds whole-word
substitutions. It is empty on purpose: add a rule only after listening to a take. A rule changes
the text's hash, which makes the lines it touches stale.

A line's id is `z:<mapID>` for a zone and `s:<mapID>:<key>` for an area, and its file is
`<mapID>/zone` or `<mapID>/<slug>` (`naming.mjs`). The addon looks a clip up through the table, so
a file name that drifts by one character plays silence. Nothing renames one.

## The lookup table and the checks

`Data/Sounds.lua` in a pack is generated:

```sh
make zones-lookup                   # export-manifest.mjs, then build-lookup.mjs (LOCALE=xx for another language)
node pipelines/zones/tools/voice/export-manifest.mjs --check    # is the committed manifest what the database says?
make zones-validate-audio           # manifest, files on disk, lookup table and lore agree
```

The lookup lists only the places the addon has words for. A take stays live after its place has
left the lore, and listing it would ship a clip nothing plays. Run `make zones-lookup` after text
or takes change. A lookup row that points at a missing file plays silence and reports nothing,
which is what `zones-validate-audio` is for.

The commands that read the manifest take the database when `DATABASE_URL` is set and the committed
files when it is empty. The make targets here pass it empty unless it is set on the command line:
`make zones-package-audio DATABASE_URL=postgres://...`. The environment variables the tools read:

| Variable | Use |
| --- | --- |
| `SPOKEN_ZONES_LANG` | The language a run acts on, English by default. Make sets it from `LOCALE=`. |
| `SPOKEN_ZONES_ROOT` | The repository root, for a deployed process whose files are not where the tools expect them. |
| `SPOKEN_ZONES_MANIFEST` | Where English's manifest is, on the droplet. |
| `SPOKEN_ZONES_AUDIO_HISTORY` | The archive of takes, set in `deploy/web/ecosystem.config.js`. |
| `SPOKEN_ZONES_WTF` | Where `seed-from-dump.mjs` finds the saved variables. |

## Languages

A language's pack is a folder `SpokenZonesAudio_<locale>`, built in `build/zones/<locale>`, with
its takes archived apart from English's. Add `LOCALE=<code>` to `zones-sounds`, `zones-pull-live`,
`zones-lookup` and `zones-package-audio` to act on one. A language's name, folder, version and
store ids come from its page under `publishers/zones/` (`scripts/lib/packs.mjs`). Nine languages
have a page: deDE, esES, esMX, frFR, koKR, ptBR, ruRU, zhCN, zhTW. Spoken's settings link to
those pages, from the table `PACK_PAGES` in `addons/Spoken/API.lua`, which
`tests/lua/packs_test.lua` keeps in step with them.

A language pack ships at one quality and has no second tier. The English pack is
`addons/SpokenZonesAudio`: its `.toc` and `Data/Sounds.lua` are committed and its `Sounds/` folder
is not. `ZoneLoreAudio64`, a 64 kbps tier, is retired and never uploaded to again.

## Building and releasing a pack

The pack releases on its own, because most releases of the module do not touch a story's voice. Each
step is a target and runs alone:

```sh
make zones-sync                     # DESTRUCTIVE: replace the local lore and takes with the droplet's
make zones-pull-live                # fetch the live takes the local database names (zones-pull-history: the whole archive)
make zones-sounds                   # assemble the pack's Sounds/ from the live takes
make zones-package-audio            # check-synced, sounds, lookup, validate-audio, then zip into dist/
make zones-release-audio-dry        # show what an upload would send
make zones-release-audio            # upload (LOCALE=xx for a language)
make zones-full-release             # all of the above, with one question before anything is uploaded
```

- `zones-check-synced` compares the local zones data with the droplet's and prompts when they
  differ. `zones-package-audio` runs it first.
- The pack's version is the `.toc`'s, and the release notes come from `docs/places/CHANGELOG.md`.
  Bump the version and add its section first. A section headed `## <version> — audio` is the
  English pack's and `## <version> — zones-audio-<locale>` is a language's.
- `zones-release-audio` uploads to CurseForge only. `zones-full-release` also runs
  `scripts/audio-github-release.sh`, which publishes the pack on GitHub. Wago refuses a file that
  size, so a Wago player gets the pack from GitHub.
- The pack depends on Spoken Player in the upload's metadata. It cannot load without Spoken.
- Bump `PACK_FORMAT` in `Audio.lua` only when the data shape of `Sounds.lua` changes, and do not
  cut a pack for a change to the module alone.
- The module ships in Spoken's zip: `scripts/spoken/package.sh` calls `scripts/zones/package.sh`.
  `scripts/zones/release.sh zones` uploads the old `SpokenZones` project's last file, the
  tombstone that `make package-spoken-retired` builds. `make zones-release` with no target
  uploads both that and the English pack.

`make zones-acted` builds an overlay pack from the voice actors' recordings, as
`SpokenZonesAudioOverlays`. No code in the addon reads that registry yet, so an overlay does
not play.

## The site

The Zones explorer is `/zones` (`/<lang>/zones` for another language) in `apps/web`, over the
`lore_line` and `take` tables. It lists every line with its text, its take and whether the take
is stale. It plays a take, edits a line, translates one and generates one. Editing and generating
need a role, and a take is cut with the signed-in editor's own key for the voice service. Deployment, the
roles and the droplet are in `deploy/web/README.md`.

A line's page, `/zones/r/<mapID>/<slug>`, is where the addon's Report button sends a player. The
slug is the key with spaces as hyphens, and `zone` for a zone. `validate.mjs` fails when the
addon's slug and `slugFor` in `naming.mjs` disagree.
