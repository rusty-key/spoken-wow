# Books

Every book, letter, note and plaque World of Warcraft will show you, extracted from the
vmangos world database, reviewable at `/books` on the site, and
read aloud in game by **SpokenBooks**.

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
| `gameobject_template` | type 9 is a book, plaque or sign; `data0` is its first page |
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
(`apps/web/src/lib/player-words.ts`, applied in `lib/books/catalogue.ts` before the text is
flattened, hashed and judged). The extract's stored `substitution` label is left as it was;
the catalogue re-judges every page from its text.

A book's first page is narrated with its title ahead of it — "Letter to Ello.", a line
break, then "The letters on this note…" — because the client shows the title and never says
it (`spokenWithTitle` in `tools/lib/text.mjs`). The break is the one newline spoken text
keeps, for the pause: fish.audio is sent the title as a request of its own, and the page is
hashed with `spokenHash`, which does not flatten it. The narration only: the stored text and the addon's checksum stay the
page's own words, so nothing in the addon changes. The 33 first pages that already open with
their title (gravestones, a treatise's `<H1>`) are left alone rather than read it twice. In
another language the title is said only where it is translated, and whether a page can be
voiced is still judged on the page alone.

Vanilla only. WoW: Forever is a Classic+ fork, so most of its books are vanilla books with
unchanged text, and the addon matches on the text rather than on an id — those play with no
extra work. Forever-only books are a known gap, to be measured before anything is built for
them.

## The stages

| Stage | Input | Output | Who runs it |
| --- | --- | --- | --- |
| `extract` | vmangos world DB | `pipelines/books/corpus/extract.json` | a maintainer, after a dump refresh |
| `import` | that file | `book_line` rows | the same maintainer |
| review | `book_line` | corrected text | anyone, at `/books` |
| generate | `book_line` | mp3s and `take` rows | anyone with an ElevenLabs key |
| export | `book_line` | `addons/Spoken_Books/Data/Books.lua` | a maintainer, before a release |

## Running it locally

The databases are OrbStack containers and a native Postgres. Nothing here touches the
droplet.

```bash
orb start
make books-db                 # the vmangos MySQL, which pipelines/quests provisions
make books-extract            # -> pipelines/books/corpus/extract.json
make books-import
pnpm --filter @spoken/web dev # /books
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
make books-test                    # the pipeline: text, naming, chains, promotion
pnpm --filter @spoken/web test     # the site, including lib/books
```

## The addon

`addons/Spoken_Books` hooks `ITEM_TEXT_BEGIN` / `READY` / `CLOSED` — the whole book UI, and
the same API on Era, Anniversary and Forever, which is why there is one addon rather than
three.

**A page is identified by what is on screen**, because the client never says which page id
it is showing. Title, page number and a checksum of the text; then the checksum alone,
where no other page shares it; then nothing. Nothing is the right third answer: the
alternative is reading the wrong page's words aloud.

**The checksum is the load-bearing part.** `pipelines/books/tools/lib/naming.mjs` and
`addons/Spoken_Books/Checksum.lua` must produce the same number for the same text, over
UTF-8 bytes, using only multiply, add and modulo — the clients run Lua 5.1, which has no
bitwise operators. `tests/lua/books_source_test.lua` asserts the two agree, on an ASCII
string and an accented one. They have to: the lookup is keyed on that number, and a
disagreement makes every page unfindable, silently.

**Mail is excluded twice.** `ItemTextFrame` serves mail as well as books, so a letter with
a creator is skipped, and so is anything shown while `MailFrame` is open — which catches
the mail that has no creator, like a returned letter.

**A book is one line in the queue.** Opening a book queues the page on screen, and each page
puts the next at the head as it finishes, so a journal reads on while you turn pages, the
queue counts it once and Skip skips the rest of it. Between its pages there is only the
source's own gap, not Pause Between Lines or the cue. Turning to the page being read or one
still to come changes nothing; turning back starts the book again from there.

**Readables pile up on purpose.** One opened while another is read queues after it: a
gravestone read on the way waits for the book. The source has no queue limit, unlike zones,
whose cap drops the oldest waiting clip and here would drop what the player opened.

**Two saved-variable tables, on purpose.** `SpokenBooksSettings` is account-wide and holds the
three switches — autoplay, whole-book, read-once. `SpokenBooksCharacter` is per character and
holds only what that character has been read, keyed by book id. Settings are how you like
the addon to behave; having read something is a thing a character did, so an alt walking
into the same library hears it fresh.

**Read-once marks a book when narration starts, not when it ends.** The addon is never told
that a clip finished — the player owns the queue — so "finished" could only be inferred
from a queue that `/spb stop` or a zone change can empty early. The rule refuses autoplay
only: `/spb read` and the Play button go straight to the playlist, because a reader pressing
play has asked again in so many words. It also does not refuse the book it is in the middle
of reading, which is what `SpokenBooks:IsNarrating` is for — a reader who jumps past the
queued pages would otherwise strand the narration on the page they turned away from.

**The panel and the button are the two files this addon reads books without.**
`UI/Options.lua` registers a settings canvas the way the zones panel does, and
`UI/PlayButton.lua` puts Play/Stop on the book window's page row. `Events.lua` guards both
calls, so a partial install still narrates. Every switch on the panel is also a `/spb`
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

**Every clip carries a Report action**, the bug icon the quests and zones clips use, falling
back to an "R" on the three legacy clients where that texture does not exist. The
client cannot open a browser or post anywhere, so pressing it raises a popup holding one
selectable address — `UI/CopyLink.lua`, the same shape the zones addon carries, and not
shared with it because two addons cannot own one StaticPopup id.

The address is `https://spoken.rusty.one/books/r/{pageTextID}`, built from the page id
alone. That is deliberate: the id is frozen, so the addon can address any page with no
per-page table to ship and nothing to escape — the trade the zones landing page makes with
its `{mapID}/{slug}` path.

**The landing page is `app/books/r/[pageId]/page.tsx`**, shaped like the zones one: the
page's words, its current take to listen to, and the report form already pointed at the
right line. Not the explorer — somebody arriving from the game is a player, not a
collaborator, and flags, takes and regenerate controls answer questions they did not ask.
`pageById` in `lib/books/catalogue.ts` resolves the id, off the memoised catalogue the rest
of the section already loads.

Reports from books needed the section admitted to `SOURCES` in `lib/reports/reports.ts`;
migration `0028` had already widened the table's check constraint, so the database was
waiting for it. `/api/reports` resolves a books address the strict way it resolves a zones
one — the reporter arrived from a page this site rendered, so an id that names nothing is a
typo rather than a corpus that failed to load — and takes the lineId from the resolved page
rather than from the request body, so nothing the reporter can edit decides which row
triage sees.

**A report presumes a page id, and a page this corpus has never seen has none to give.** That
is every post-vanilla book, every locale but one, and custom text a server added
itself — `Contribute.lua`'s `HasContributionGap` is true exactly there, whenever
`PageOnScreen` found nothing. The Play button itself becomes the way to say so: relabelled
**Contribute** in that state, it opens the same copy box the Report action uses, holding an
envelope instead of an address — the addon, the build, the locale, the book, the page number,
the checksum the page would be looked up by if the corpus knew it, and the page's own text.
**Mail is excluded the same way narration already excludes it**, doubly: a letter with a
creator, or anything shown while `MailFrame` is open, is never captured. The player copies the
box, opens `spoken.rusty.one/contribute`, pastes, and sees exactly what is about to be sent
before it goes — the same page, submitted again by the same or another reader, bumps a count
on one row at `/contributions` rather than filing a second.

`UI/Layout.lua` is the fourth copy of a file that must stay byte-identical across
Spoken, SpokenQuests, SpokenZones and SpokenBooks;
`pipelines/quests/tests/test_package.py` is what enforces that.

### Installing it in a client

```bash
make books-deploy                  # symlink into Classic Era
CLIENT=forever make books-deploy   # or the Forever beta (wow_classic_beta)
make books-status                  # what is installed where, and how many mp3s exist
```

## Releasing

The two CurseForge projects:

| Project | id | Slug |
| --- | --- | --- |
| Spoken Books | 1701514 | `spoken-books` |
| Spoken Books Audio | 1701520 | `spoken-books-audio` |

Cutting one:

```bash
make books-package                 # -> dist/Spoken_Books-<version>.zip
make books-package-audio           # -> dist/SpokenBooksAudio-<version>.zip
make books-release-dry             # what would be uploaded, uploading nothing
make books-release                 # needs CURSEFORGE_TOKEN
```

The version is the `## Version:` line in each `.toc`, and the release notes are the matching
`## <version>` section of `docs/books/CHANGELOG.md` — a version with no section there fails
before anything is sent. `scripts/books/release.sh` carries the two ids in
`target_curseforge()`, and an unknown target fails on the empty id rather than defaulting, for
the reason `docs/quests/CLAUDE.md` gives: an id left in that function is an id something
eventually uploads to, and uploading a books pack over another project is not recoverable
from this side.

The addon uploads before the pack, because the pack declares it as a required dependency and
CurseForge resolves a `relations` slug at upload time — against an *approved* project. Both
projects are new, so the first release is the one that can meet that gate late: if
`spoken-books` is still in moderation the pack's upload is rejected with errorCode 1018, and
the fix is to send the pack again once the project is approved.

The project pages themselves are `publishers/books/*.md`, one body per project for both
stores; after `make descriptions`, paste `dist/descriptions/<slug>.md` into CurseForge and
`dist/descriptions-wago/<slug>.md` — the same text with its cross-links pointed at Wago —
into Wago, then record it with `make descriptions-published`.

`make books-release` sends each zip to both stores. The pack goes to CurseForge alone: at
452 MB it meets a 413 from Cloudflare before Wago sees it, which `scripts/lib/wago.sh` says
in as many words. `make audio-release` then publishes it as a GitHub release under
`books-audio/vX.Y.Z`, which is where the Wago page for Spoken Books sends anyone looking for
the narration.

### A language's pack

A page under `publishers/books/`, `spoken-books-audio-<lang>.md`, is what makes a language's
pack exist — its `curseforge:`, `version:` and `slug:` are what `scripts/lib/packs.mjs` reads,
rather than a case a script would grow per language. `LOCALE=` moves the whole chain to that
language, staged under `build/books/<lang>/` rather than the committed `addons/SpokenBooksAudio/`:

```bash
make books-pull-live LOCALE=esMX      # this language's live takes
make books-sounds LOCALE=esMX         # build/books/esMX/Sounds, from the archive
make books-lookup LOCALE=esMX         # build/books/esMX/Data/Sounds.lua
LOCALE=esMX ./scripts/books/package-audio.sh  # dist/SpokenBooksAudio_esMX-<v>.zip
make books-release-audio LOCALE=esMX  # uploads it, CurseForge only
```

The addon finds a page by its title and a checksum of its words, and a client in another
locale shows neither in English. So a language's `Data/Sounds.lua` also carries that
language's `index` and `loose`, in the shape of `Spoken_Books/Data/Books.lua`'s: every page
the world database translates, under each name its owners have in that language, keyed on the
text as the client shows it — the newest *extracted* version, not a correction made on the
site. The reader asks it only on a client in the pack's language, before the English index.
It is built from `book_line` and `entity_name`, so run `make books-import-locale LOCALE=esMX`
first; `books-lookup` warns when it finds no pages. The checksum is exact: a page whose words
on a live client differ from the world database's by one byte is not found, and is what the
contribution button is for.
