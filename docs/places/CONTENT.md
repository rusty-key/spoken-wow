# Adding content and finding what is missing

Run the commands from the repository root. The scrapers and exporters need Node 18 and, for
anything that reads the database or the voice manifest, `pnpm install` at the root first
(`pipelines/zones` declares the `pg` and Claude SDK packages the voice tools and the rewrite import).

## Adding a place

A place is one story: a zone (`z:<mapID>`) or an area (`s:<mapID>:<key>`). The id and the key are
frozen once a story has one, so choose the key with care ([LORE.md](LORE.md)).

An area with a wiki page. The wiki lists an area under `Category:<Zone> subzones`.

1. Check that the zone is in `pipelines/zones/tools/seed/subzones.json`. `category`, `exclude` and
   `aliases` there settle a category that lists more than the zone's areas.
2. `node pipelines/zones/tools/scrape-subzones.mjs --list <uiMapID>` shows what the category holds.
3. Scrape it with `DATABASE_URL` set. A run limited to one zone (`--zone <uiMapID>`) records into
   the database, and writes nothing at all without one. Then run `make zones-lore-export` and
   commit the diff under `addons/Spoken_Places/Data/`.
4. If the page is long, rewrite it with Claude first (`rewrite-lore.mjs`, which spends credits).
5. Run `make zones-check`, then the voice steps below if the place should be read aloud.

An area the client has and the wiki does not. The export keeps any place in the AreaTable seeds
(`seed/era-areas.json`, `seed/camelot-areas.json`) as a `pending = true` entry with empty text, so the
tab lists it and says it is not written yet. Someone writes it on the site, which records it as
`edited`. Contribute on a pending place sends the player's description to the site.

A zone. Add its uiMapID and wiki title to `seed/zones.json` and add it to `seed/subzones.json`. With
`DATABASE_URL` set, run `scrape.mjs --only <uiMapID>` and `scrape-subzones.mjs --zone <uiMapID>`, then
export. Check the ids against a client with `/spp verify`.

A dungeon or raid. Add it to `pipelines/lib/dungeons.json` under `dungeons`, keyed by its
instance map, with `zone` (the zone of its entrance) and, if it has a story, `story`
(`[uiMapID, "key"]`, the area whose story is its card). Then `make dungeons` and the exporters in
[COMPENDIUM.md](COMPENDIUM.md). An area listed under a different zone than its story takes an
entry in `addons/Spoken_Places/Data/AreaZones.lua` instead.

A place only Forever has, or names differently. Add it to `seed/forever-places.json` with the
reason, then `make zones-forever-areas`.

## Adding a picture

Put the chosen picture's `- new.png` and `- old.<ext>` in the choices folder under the place's
folder, then `make zones-pictures CHOICES=<folder>`. Add a `CROPS` entry for a picture whose best
2:1 band is not where the detail is. See [PICTURES.md](PICTURES.md). Look at the result in the game,
credit anything new in `THIRD_PARTY.md`, and restart the client to see a new texture.

## Adding a language

Text and voice are separate, and a language can have one without the other.

Text. The stories are written on the site in that language, and the interface strings in
`Locale/<code>.lua` (the keys are `Locale/enUS.lua`'s). The steps, in order:

1. Add the language to `pipelines/lib/locales.mjs` and the same list in `Language.lua`
   (`validate.mjs` fails when they differ).
2. For a language a client runs in, `make zones-aliases` builds `Data/<locale>/Aliases.lua`.
   `make zones-lore-import-names LOCALE=<code>` names the places on the site.
3. Translate the lines on the site, then `make zones-lore-export`.
4. List the new data files and `Locale/<code>.lua` in `Spoken_Places.toc` in the order
   `validate.mjs` checks.
5. `make zones-languages`. The language is offered once it is ready.
6. `make zones-check` and `luajit tests/lua/locale_parity_test.lua`. Check the strings fit with
   `luajit tests/lua/settings_fit_test.lua <code>`.

Voice. Cut the takes on the site, then follow "Languages" in [VOICE.md](VOICE.md). Add the
language's page under `publishers/zones/` (the project id comes from creating it on CurseForge by
hand), its row in `PACK_PAGES` in `addons/Spoken/API.lua`, and run `tests/lua/packs_test.lua`.

## Finding what is missing

No script in the repository produces a list of everything that is missing. These commands and
greps answer each part from the data.

| What | How |
| --- | --- |
| Zone maps the data lacks | Compare the ids in `seed/zones.json` with `Data/enUS/Zones.lua`. `/spp verify` in the game checks the ids against that client. |
| Areas with no story | Entries with `pending = true` in `Data/enUS/Zones.lua` and `Subzones.lua`. At present 5 zones and 86 areas. `validate.mjs` prints the totals. |
| Areas the client has and the lore does not | Names in `seed/era-areas.json` and `seed/camelot-areas.json` whose keys are in no Subzones file. `/spp debug` prints the name and key of the area the character stands in. |
| Dungeons with no card | Entries in `pipelines/lib/dungeons.json` without `story`. |
| Places with no picture | Zone and area keys in the lore and not in `Data/Pictures.lua`. |
| Lines with no voice | `node pipelines/zones/tools/voice/generate.mjs --missing --list` (per language with `SPOKEN_ZONES_LANG`). |
| Lines whose voice is out of date | `generate.mjs --stale --list`. |
| Languages not finished | `make zones-languages`, then the counts in `Data/Languages.lua`. `check-strings.mjs` reports the interface strings. |
| Zones with no icon of their own | `ZONE_ICONS` in `addons/Spoken/API.lua`. A map with no icon takes its parent's. A dungeon card uses a key icon. |
