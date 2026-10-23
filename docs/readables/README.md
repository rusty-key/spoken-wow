# Readables

Every book, letter, note and plaque World of Warcraft will show you, extracted from the
vmangos world database, reviewable at `/readables` on the site, and
read aloud in game by Spoken's Readables module (`addons/Spoken_Readables`).

Players see this section as **Readables**: the module, its page and tab, its commands (`/spr`; `/spw`
and `/spb` still work), the sound packs' titles and the site's labels. Until 2026-10 everything they
never see said books; it all says readables now but the `b:{pageTextID}` line ids (frozen), the
retired `spoken-books` CurseForge project and the history. What players already have under the old
names is still read: `SpokenBooksSettings` and `SpokenBooksCharacter` are carried over once, packs
released as `SpokenBooksAudio*` (writing `SpokenBooksAudioPacks`) still play until their
`SpokenReadablesAudio*` replacement is installed, the site redirects `/books` and reads
`!SPOKEN1 books` envelopes, and the manager counts `books-audio*` releases as the packs'.

## Where the words come from, and why not from anywhere else

Page text is the one part of WoW's text that no file on disk contains. The client receives
it from the server when you interact with the object or open the item, and it is never
shipped in the game data. Two things follow, and both were checked rather than assumed:

- **Client data has none of it.** `WoWDBDefs` defines no `Book` or `PageText` table in any
  build, in any lineage, vanilla through retail. The only related definition is
  `PageTextMaterial`, which describes the frame the client draws around the words. The
  WoW: Forever beta client (codename Camelot) is mainline-lineage and no different.
- **Wowhead has none of it either.** Its listviews scrape cleanly — `/classic/objects/
  containers/book` returns ids and names as JSON — but the object pages carry no page text.
  Wowhead never stored it.

What does have it, with ids and eight translations, is the **vmangos world database**: the
same dump `pipelines/quests` already downloads and loads for the quest corpus.

| Table | What it holds |
|---|---|
| `page_text` | `entry`, `text`, `next_page` — the pages, as a linked list |
| `locales_page_text` | the same pages in eight other languages, on the same ids |
| `gameobject_template` | type 9 is a book, plaque or sign; `data0` is its first page. Type 10, a goober (the Ameth'Aran tablets), opens the page in `data7` when used |
| `item_template` | `page_text`, `page_language`, `page_material` — letters, notes, scrolls |

## What is in the corpus

From the 1.12 patch rows of one dump:

- **1191 pages** across **404 books**, under **381 distinct titles**
- **743 pages** are carried items — letters, notes, scrolls. **448** are objects in the world.
- **66 pages** are orphaned: page text for content that was cut, which nothing can open.
- **1 page** is claimed by two chains, and belongs to the one with the lower first page.
- **88 pages** cannot be voiced — 36 hold substitution tokens the client fills in at
  runtime, 26 are empty, 26 say "Missing Text". They stay in the corpus, labelled: the game
  has them, and a corpus that dropped them would look like it had missed them.

That leaves **1103 voiceable pages, 385,631 characters** by the extract's count. The site
counts the 36 token pages as voiceable too: it speaks `$N`, `$C` and `$R` as "adventurer"
and "traveler", or the page's language's own words, and takes `$G`'s first branch
(`apps/web/src/lib/player-words.ts`, applied in `lib/readables/catalogue.ts` before the text is
flattened, hashed and judged). The extract's stored `substitution` label is left as it was;
the catalogue re-judges every page from its text.

Words in angle brackets are read, as a quest's stage directions are: `<illegible text>`,
`<The rest of the book is blank>`. Each is set apart by a line break on either side, so it is
not run into the sentence around it. Four of the 26 empty pages above held nothing else, and
are voiced in every language now. Only the tags of the 54 signed pages (`<HTML>`, `<P>`,
`<BR/>`, `<IMG>` and the rest) are dropped, and esMX's `<nombre>`, which would otherwise be
read as the word.

The signed pages are HTML in `page_text`. `normaliseText` stores them as the lines the
client draws, so the site shows words rather than tags. The addon's `Normalise` lays out what
`ItemTextGetText` returns the same way before it takes the checksum; it also tries the
checksum over the HTML, which is what packs built before 2026-10-18 are keyed on.

A book's first page is narrated with its title ahead of it — "Letter to Ello.", a line
break, then "The letters on this note…" — because the client shows the title and never says
it (`spokenWithTitle` in `tools/lib/text.mjs`). The break is kept for the pause: fish.audio is sent the title as a request of its own, and the page is
hashed with `spokenHash`, which does not flatten it. The narration only: the stored text and the addon's checksum stay the
page's own words, so nothing in the addon changes. The 33 first pages that already open with
their title (gravestones, a treatise's `<H1>`) are left alone rather than read it twice. In
another language the title is said only where it is translated, and whether a page can be
voiced is still judged on the page alone.

WoW: Forever is a Classic+ fork, so most of its books are vanilla books with unchanged text,
and the addon matches on the text rather than on an id — those play with no extra work.
Forever's own readables, which vmangos has no page of, come from the Forever repack that
`places.mjs` also reads (`PLACES_MYSQL_*`): the objects and items named in `FOREVER_OBJECTS`
and `FOREVER_ITEMS` (`tools/lib/world.mjs`), with an item's first page from Forever's client.
They are named one by one, because the repack also holds retail page chains Forever never
shows. Today that is the Zephras Isle readables and Advisor Nazgrel's Instructions. Their
words are the repack's, sniffed from Forever, until a player's contribution says otherwise.
Where the repack is not running, the extract says so and leaves them out, which removes
nothing: the import only adds and updates.

## Pages in any language

A page's structure lives in `book_page`, once for every language: its book, its place in it, and
the item or object that opens it. `book_line` holds the words, one versioned row set per language.
A page needs no English row, so a page only a Spanish client has shown exists in Spanish alone.

A player's client sends a page with its words, its title and page number, and the item or object
it was read from, but no page id. The site matches it the way a person would: by the owner first,
then the same words in any language, then the title and page number in the row's language
(`apps/web/src/lib/contributions/book-match.ts`). Where two pages remain, nothing is guessed and a
moderator picks one.

Accepting a row for a page nothing in the corpus has mints it: `b:n{uuid}`, in the matched book or
in a new `n{uuid}` book. A minted page is voiced, reported and shipped in packs like any other. If
a later import finds its words in the world database, it folds into the real page: texts, takes,
reports and contributions move, and the minted id stays as an alias so a pack that shipped it still
plays (`pipelines/readables/tools/lib/absorb.mjs`).

## The stages

| Stage | Input | Output | Who runs it |
| --- | --- | --- | --- |
| `extract` | vmangos world DB, and the Forever repack for Forever's own | `pipelines/readables/corpus/extract.json` | a maintainer, after a dump refresh |
| `import` | that file | `book_page` and `book_line` rows | the same maintainer |
| review | `book_line` | corrected text | anyone, at `/readables` |
| generate | `book_line` | mp3s and `take` rows | anyone with an ElevenLabs key |
| export | `book_line` | `addons/Spoken_Readables/Data/Books.lua` | a maintainer, before a release |

## Running it locally

The databases are OrbStack containers and a native Postgres. Nothing here touches the
droplet.

```bash
orb start
make readables-db                 # the vmangos MySQL, which pipelines/quests provisions
make readables-extract            # -> pipelines/readables/corpus/extract.json
make readables-import
pnpm --filter @spoken/web dev # /readables
```

`DATABASE_URL` and the vmangos connection both come from the repo root's `.env`; copy
`.env.example` to `.env` there once and every pipeline reads it.

The extract connects with `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` and
`MYSQL_DATABASE` — the same five the quests extract reads, because it is the same dump —
defaulting to the quests `docker-compose.yml` values. Those names used to be `BOOKS_`-prefixed
here, and the hazard the prefix guarded against has not gone away: a bare `MYSQL_PASSWORD`
exported by some other project turns this into an access-denied error that reads exactly like
a dump that was never loaded, which is an afternoon nobody needs twice. What replaced the
prefix is `loadEnv(..., { override: MYSQL_VARS })` in `tools/extract.mjs`: the file wins over
the shell for those five, exactly as `tts_cli/env_vars.py` has always loaded its own with
`override=True`.

If the dump has never been loaded on this machine, the quests pipeline's bootstrap does it
— it fetches vmangos `db_latest` and loads `mangos.sql`. Once, and slowly.

## Re-importing is safe

A re-import records a new version of a page and promotes it only when the live version is
itself `extracted`. A hand-corrected page keeps its correction until somebody promotes the
new text from the history. Identical text is not recorded at all, so version numbers count
changes rather than imports.

Structure is different, and moves in place: which book a page belongs to, its number, its
title and its owners are facts about the world rather than content, so the import corrects
them on the live row — on edited pages too. Without that, a page could only be re-placed by
changing its wording as well, and one page did move between books without a word changing.

## Tests

```bash
make readables-test                    # the pipeline: text, naming, chains, promotion
pnpm --filter @spoken/web test     # the site, including lib/readables
```

## The addon

`addons/Spoken_Readables` hooks `ITEM_TEXT_BEGIN` / `READY` / `CLOSED` — the whole book UI, and
the same API on Era, Anniversary and Forever, which is why there is one addon rather than
three.

**A page is identified by what is on screen**, because the client never says which page id
it is showing. Title, page number and a checksum of the text; then the checksum alone,
where no other page shares it; then, for a page the client filled with the reader's name,
class or gender word, its words against the captions that hold a token, where exactly one
fits. Then two steps for a server that lays out or words a page differently from the corpus:

- **What opened the frame.** `Opener.lua` notes the item used from the bags
  (`C_Container.UseContainerItem`), the object a tooltip was last on and the interact key's
  object. `Books.lua`'s `owners` maps the id to its book, and the page number picks the page.
  Refused where the book has no page at that number, or where the title on screen is another
  corpus book's, which means the id was something touched before the click.
- **Title, page number and most of the words.** At least 60% of the distinct words in common,
  and the client's next-page arrow agreeing with where the book ends. The words are the guard:
  the server may hold a book of the same name that the corpus lacks ("Proof of Deed" is many
  bosses' deeds).

Either way the clip is the corpus page's, so a page the server rewords plays the corpus's words.
Then nothing. Nothing is the right last answer: the alternative is reading the wrong page's
words aloud.

**The checksum is the load-bearing part.** `pipelines/readables/tools/lib/naming.mjs` and
`addons/Spoken_Readables/Checksum.lua` must produce the same number for the same text, over
UTF-8 bytes, using only multiply, add and modulo — the clients run Lua 5.1, which has no
bitwise operators. `tests/lua/readables_source_test.lua` asserts the two agree, on an ASCII
string and an accented one. They have to: the lookup is keyed on that number, and a
disagreement makes every page unfindable, silently.

**Mail is excluded twice.** `ItemTextFrame` serves mail as well as books, so a letter with
a creator is skipped, and so is anything shown while `MailFrame` is open — which catches
the mail that has no creator, like a returned letter.

**A book is one line in the queue.** Opening a book queues the page on screen, and each page
puts the next at the head as it finishes, so a journal reads on while you turn pages, the
queue counts it once and Skip skips the rest of it. Between its pages there is only the
source's own gap, not Pause Between Lines or the cue. Turning to the page being read or one
still to come changes nothing; turning back starts the book again from there. The progress
bar runs across the book: each page carries the seconds before it and the reading's length
(`clip.span`), unless a page in it has no recorded length. *Read Book as One Line* (on by default,
`/spr oneline`) turns this off: every page is queued at once as a line of its own, the book's
title over its page count, grouped so no pause or cue falls between them.

**Readables pile up on purpose.** One opened while another is read queues after it: a
gravestone read on the way waits for the book. The source has no queue limit, unlike places,
whose cap drops the oldest waiting clip and here would drop what the player opened.

**Settings and reading are kept apart, on purpose.** The settings (autoplay, whole book, one
line, read once, stop when the book closes, close when read, the voice language and the
Compendium's switches) live in Spoken's profile under `Writings`, bound by
`Spoken:BindModuleSettings` and copied from `SpokenReadablesSettings` the first time. That saved
variable keeps its name and stays the module's own table until Spoken binds it.
`SpokenReadablesCharacter` is per character and holds what that character has read and found,
keyed by book id. Settings are how you like the addon to behave; having read something is a
thing a character did, so an alt walking into the same library hears it fresh.

**Read-once marks a book when narration starts, not when it ends.** The addon is never told
that a clip finished — the player owns the queue — so "finished" could only be inferred
from a queue that `/spr stop` or a zone change can empty early. The rule refuses autoplay
only: `/spr read` and the Play button go straight to the playlist, because a reader pressing
play has asked again in so many words. It also does not refuse the book it is in the middle
of reading, which is what `SpokenReadables:IsNarrating` is for — a reader who jumps past the
queued pages would otherwise strand the narration on the page they turned away from.

**The panel and the button are the two files this addon reads books without.**
`UI/Options.lua` is the module's page under Spoken's in the game's settings
(`Spoken:AddSettingsPage`), laid out by Spoken's `UI/Layout.lua` like the other modules' pages,
and `UI/PlayButton.lua` puts Play/Stop on the book window's page row. `Events.lua` guards both
calls, so a partial install still narrates. Every switch on the panel is also a `/spr`
command, which is what a client with no Settings API gets.

**The button is anchored to `ItemTextScrollFrame` — the page — in its bottom-right corner,
and not to anything on the row above it.** That row looks empty on page one and is not:
`ItemTextFrame.xml` in `Gethe/wow-ui-source` gives the two arrows a `PREV` and a `NEXT`
FontString anchored to their inner edges, and `ItemTextCurrentPage` is a 192-wide FontString
centred across the row whose left edge reaches back under the left arrow. A book with more
than one page fills all of it. The scrollbar hangs outside the page's right edge — its
textures anchor `TOPLEFT` to the frame's `TOPRIGHT` — so the page's own corner is clear of
that too. Both the Classic frame (Era, Anniversary) and the Mainline one (Forever) name and
place all of this identically, so one anchor covers three clients.

The cost is that a full page's last line runs under the button; the alternative was
colliding with one of Blizzard's controls on page two of every book.

**Every clip carries a Report action**, the bug icon the quests and places clips use. The
client cannot open a browser or post anywhere, so pressing it raises a popup holding one
selectable address — `UI/CopyLink.lua`, the same shape the Places addon carries, and not
shared with it because two addons cannot own one StaticPopup id.

The address is `https://spoken.rusty.one/readables/r/{pageTextID}` (`/{lang}/readables/r/…` when
the clip was read in another language, through `Spoken:ReportURL`), built from the page id
alone. Released older addons built `/books/r/…`, which the site sends on to `/readables/r/…`
(`lib/section-routes.ts`). Building from the id alone is deliberate: the id is frozen, so the addon can address any page with no
per-page table to ship and nothing to escape — the trade the places landing page makes with
its `{mapID}/{slug}` path.

**The landing page is `app/[lang]/readables/r/[pageId]/page.tsx`**, shaped like the places one: the
page's words, its current take to listen to, and the report form already pointed at the
right line. Not the explorer — somebody arriving from the game is a player, not a
collaborator, and flags, takes and regenerate controls answer questions they did not ask.
`pageById` in `lib/readables/catalogue.ts` resolves the id, off the memoised catalogue the rest
of the section already loads.

Reports from readables needed the section admitted to `SOURCES` in `lib/reports/reports.ts`;
migration `0028` had already widened the table's check constraint, so the database was
waiting for it. `/api/reports` resolves a readables address the strict way it resolves a places
one — the reporter arrived from a page this site rendered, so an id that names nothing is a
typo rather than a corpus that failed to load — and takes the lineId from the resolved page
rather than from the request body, so nothing the reporter can edit decides which row
triage sees.

**A report presumes a page id, and a page this corpus has never seen has none to give.** That
is every post-vanilla book, every locale but one, and custom text a server added
itself — `Contribute.lua`'s `HasContributionGap` is true exactly there, whenever
`PageOnScreen` found nothing. The Play button itself becomes the way to say so: relabelled
**Contribute** in that state, it opens Spoken's contribute box (`UI/ContributeBox.lua`) with an
envelope instead of an address — the addon, the build, the locale, the book, the page number,
the checksum the page would be looked up by if the corpus knew it, and the page's own text.
**Mail is excluded the same way narration already excludes it**, doubly: a letter with a
creator, or anything shown while `MailFrame` is open, is never captured. The box holds a link
to `spoken.rusty.one/contribute` that carries the envelope, or, where no link can be built, the
envelope and the address to paste. The player copies it, opens it, and sees exactly what is
about to be sent before it goes — the same page, submitted again by the same or another
reader, bumps a count on one row at `/contributions` rather than filing a second. The first
click ever also offers Spoken's **Collect Missing Lines**, which keeps such pages in
`SpokenContributions.lua` for the player to upload at `/contribute`.

### The Readables tab

Azeroth's Compendium (Spoken's `UI/Compendium.lua`, shared with the Quests and Places tabs) is a
movable window that closes on Escape, resizes from its corner and folds down to its list. The
Readables tab (`UI/Readables.lua`, key `readables`) lists
every book, letter, note, scroll, tablet, plaque, gravestone, exhibit and picture Spoken Readables
reads, found or not, with the words of each on the right, on the spellbook's parchment, to read
and to listen to wherever you are. Which readables exist and where they are comes from
`Data/Places.lua` (`pipelines/readables/tools/places.mjs`); what this character has found, from
`SpokenReadablesCharacter` (`Core.lua`); the words, from `Data/Books.lua`. `make readables-places` reads
the repack's world DB (`PLACES_MYSQL_*`) and its map files (`PLACES_MAPS`, the repack's `data/maps`
folder; it stops without them). A quest places a readable only when the quests corpus or the
client's QuestV2 has it: the repack also carries Cataclysm's quest rows.

**The list.** A banner for each continent, Kalimdor and the Eastern Kingdoms, each opening and
closing on its own. Under a continent each zone is a line (its name, and how many of its readables are
found out of all with the share), a city a line inside the zone around it, and
after the city the line of each dungeon or raid whose entrance is in the zone (a zone with several
has a Dungeons and Raids line holding them, as on Quests). Several can be open at once. An
opened zone or dungeon has a line for each kind of readable it holds, closed until chosen, and the
readables under it, each once: a city's under the city, a dungeon's under its line. After the
continents come Other Lands' banner (zones on no continent) and Battlegrounds'; then a banner for
the seasonal events, for the readables had in more than eight zones (Across Azeroth) and for those
whose origin is not known. Holidays and Events holds a line for each event (Feast of Winter Veil,
Harvest Festival, Stranglethorn Fishing Extravaganza, Scourge Invasion; `event` in
`Data/Places.lua`, `EVENTS` in `Readables.lua`), each with a line per kind inside; a readable whose
event the data does not name is listed under its kind alone. A banner shows only for a continent or
a kind; everything else is a line. A readable is listed in every zone it is had in: a lore book
shelved in Stormwind and in Scholomance is under both zones, because a player looking through
either place expects to find it there. Inside a zone it is listed once: under the city where it
is also in the zone around it, under the dungeon's line where it is had only from inside a
dungeon whose entrance is in that zone (`dungeons` in `Data/Places.lua`, the instance maps of
Spoken's `Data/Dungeons.lua`). A continent's banner counts each readable once, so its count can
be less than the sum of its zones'.

**What the list keeps.** The search box looks in names only: a search naming a place lists
everything under it, a title lists itself under its place. The filter menu has Found Only and Voiced
Only, which leave out what has nothing found or voiced and take it from the counts, By Zone (the
default) or By Type, and the window's Unlock Unfound Readables, which makes every one readable
here. Without it a readable not found yet is greyed with a padlock, and its page says to open it in
the world. A filter that hides the chosen row moves the page to the nearest row above it that is
still listed, or to where the player stands; a row chosen only because the player stood there is
chosen again. The window opens on where the player stands: the dungeon's line, else the zone's,
else the continent's banner.

**The page.** A readable's page has its name, the places it is in under it (its first two zones, and
how many more; a click goes up to its kind in its place, then the zone and the continent), and
then its words, all its pages one after another. A zone's, city's, continent's
or dungeon's page has its count and Places' picture of the place above it; the other lines (a kind,
a banner) show their count alone. Play starts the readable from its first page with a recording and becomes Stop and then
Replay while it is read, as every Play of the Compendium's; browsing here does not count as hearing
it in the world (Read Only Once), nor as finding it. Report is there on every page, voiced or
not: it files the page being read, else the first with a recording, else the first, at
`/readables/r/<page id>`, which the site renders for an unvoiced page too. Hide Report Buttons, in
Spoken's settings, takes it away. Shift-click on a readable's row queues it behind what is playing
and leaves the page as it was.

**Opened from elsewhere.** The book frame and DialogueUI's book view have the Compendium's tome
button (`UI/PlayButton.lua`, `NewOpenButton`), which opens this tab on that readable with what holds
it opened (`SpokenReadables:ShowReadables(bookId)`). It shows for readables listed, and found or with
Unlock Unfound Readables on (`SpokenReadables:CompendiumHas`).

### Installing it in a client

```bash
CLIENT=forever make readables-deploy   # symlink Spoken_Readables and SpokenReadablesAudio into the Forever beta (wow_classic_beta)
make readables-status                  # what is installed where, and how many mp3s exist
```

`scripts/readables/deploy.sh` links only those two folders and defaults to Classic Era, so pass
`CLIENT=forever`. It looks under `/Applications/World of Warcraft`. Spoken has to be installed
as well: the repo's `/link-addon` skill links every addon folder of a checkout into a client,
Forever by default.

## Releasing

The module ships inside Spoken's zip: `make package-spoken` builds `Spoken-<version>.zip`, the
release is tagged `spoken/v<version>`, and its notes are in `docs/spoken/CHANGELOG.md`. Two
CurseForge projects are left here:

| Project | id | Slug |
| --- | --- | --- |
| Spoken Books, retired | 1701514 | `spoken-books` |
| Spoken Audio: Readables | 1701520 | `spoken-audio-readables` |

The first is retired and gets no more uploads. The second is the sound pack, which declares
`spoken` as its required dependency. Cutting a pack:

```bash
make readables-package-audio           # -> dist/SpokenReadablesAudio-<version>.zip
make readables-release-dry             # what would be uploaded, uploading nothing
make readables-release                 # needs CURSEFORGE_TOKEN
```

The pack's version is the `## Version:` line in its `.toc`, and its release notes are the
matching `## <version>` section of `docs/readables/CHANGELOG.md` — a version with no section there
fails before anything is sent. `make readables-package` builds `Spoken_Readables` alone, for a
`readables/v<version>` tag, which `.github/workflows/release-addons.yaml` still builds.
`scripts/readables/release.sh` carries the two ids in
`target_curseforge()`, and an unknown target fails on the empty id rather than defaulting, for
the reason `docs/quests/CLAUDE.md` gives: an id left in that function is an id something
eventually uploads to, and uploading a readables pack over another project is not recoverable
from this side.

The project pages themselves are `publishers/readables/*.md`, one body per project for both
stores; after `make descriptions`, paste `dist/descriptions/<slug>.md` into CurseForge and
`dist/descriptions-wago/<slug>.md` — the same text with its cross-links pointed at Wago —
into Wago, then record it with `make descriptions-published`.

`make readables-release` uploads the pack to CurseForge alone: at 452 MB it meets a 413 from Cloudflare before Wago sees it, which `scripts/lib/wago.sh` says
in as many words. `make audio-release` then publishes it as a GitHub release under
`readables-audio/vX.Y.Z`, which is where the pack's Wago page sends anyone looking for
the narration.

### A language's pack

A page under `publishers/readables/`, `spoken-readables-audio-<lang>.md`, is what makes a language's
pack exist — its `curseforge:`, `version:` and `slug:` are what `scripts/lib/packs.mjs` reads,
rather than a case a script would grow per language. `LOCALE=` moves the whole chain to that
language, staged under `build/readables/<lang>/` rather than the committed `addons/SpokenReadablesAudio/`:

```bash
make readables-pull-live LOCALE=esMX      # this language's live takes
make readables-sounds LOCALE=esMX         # build/readables/esMX/Sounds, from the archive
make readables-lookup LOCALE=esMX         # build/readables/esMX/Data/Sounds.lua
LOCALE=esMX ./scripts/readables/package-audio.sh  # dist/SpokenReadablesAudio_esMX-<v>.zip
make readables-release-audio LOCALE=esMX  # uploads it, CurseForge only
```

The addon finds a page by its title and a checksum of its words, and a client in another
locale shows neither in English. So a language's `Data/Sounds.lua` also carries that
language's `index` and `loose`, in the shape of `Spoken_Readables/Data/Books.lua`'s: every page
the world database translates, under each name its owners have in that language, keyed on the
text as the client shows it — the newest *extracted* version, not a correction made on the
site. The reader asks it only on a client in the pack's language, before the English index.
It is built from `book_line` and `entity_name`, so run `make readables-import-locale LOCALE=esMX`
first; `readables-lookup` warns when it finds no pages. The checksum is exact: a page whose words
on a live client differ from the world database's by one byte is not found, and is what the
contribution button is for.
