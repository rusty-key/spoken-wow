# Books without English: a page exists in any language

Written on 2026-10-13. The plan for taking English out of the books section's skeleton, as quests
(`a1cfeddb`) and gossip (`fd97463b`) already have. Nothing here is built yet. Zones get a spec of
their own.

## Why

A books contribution sent from a client in another language arrives in triage with no page. Two
cases show up in the queue:

- **Nota de Wiley** (esES, Forever 70338) is page 38/39. The world database's esES text for it
  is a different and partly English version ("Stoutmantle -- Qué descaro…"). The live client
  shows the esMX wording ("Mantorrecio: Hay que tener osadía…"). The esES pack indexes the
  extract's text, so the checksum misses and the page is sent as a contribution. Contribution
  30090 (esES) is the same case: its text is esMX page 340's, word for word.
- **Instrucciones del consejero Nazgrel** (esES) is a page that no language in the corpus has.

Neither one can be accepted today:

- **Accepting needs an English page.** `acceptBookTranslation` (`lib/contributions/accept.ts`)
  refuses a row whose `pageId` is null. It copies the page's structure (lineId, bookId, page
  number and count, owners, material) from the English `book_line` row, and refuses again if
  there is none.
- **Only a moderator sets `pageId`.** The envelope carries a checksum of the translated text,
  which names no page, and intake does not try to match.

The import skips every locale page with no English row (`withoutEnglish` in
`pipelines/readables/tools/lib/locale.mjs`). That skip is right and stays: a `locales_page_text` entry
is a `page_text` entry, and the English extract already holds every one something can open. The
rest are the orphans the README counts.

## What was decided

Settled in session `9ebb7569` (2026-10-11) and in the session that wrote this note:

- A language-neutral table holds a page's identity and structure. A text table, keyed by a
  `lang` column, holds its title and text. English is one language among the others.
- A language may have a page English does not have, at a position English does not know about.
  In English that page is listed with a `<no text>` placeholder.
- A page with no `pageTextID` gets a minted id, `b:n{uuid}`.
- Intake and triage match a contribution to its page automatically, and a moderator can
  override the match.
- A contribution whose page already has different text in its language is a **correction**, as
  for quests.
- The addon starts sending the item or object a page was read from, if the client exposes it.
  A probe decides this first.
- `book_line` stays as the text table, and a new `book_page` table takes the structure.

## Data model

### `book_page` (new)

One row for each page that exists in any language.

| column | type | notes |
|---|---|---|
| `lineId` | text, primary key | `b:{pageTextID}` for an extracted page (frozen, as today), or `b:n{uuid}` for a minted one |
| `pageTextId` | int, null | null for a minted page |
| `bookId` | text | the first page's `pageTextID` as text, as today, or `n{uuid}` for a minted book |
| `pageNumber` | int | position in the book. Unique per `bookId`, gaps allowed |
| `ownerKind` | text, null | `object` or `item`. Null for a minted book until an owner is known |
| `ownerIds` | int[], null | as above |
| `material` | int, null | as above |
| `aliasOf` | text, null, references `book_page.lineId` | set when a minted page turns out to be an extracted one |

A book's page count is not stored. It is `count(*)` of the book's pages, so adding a page
never leaves a stale count.

### `book_line` (kept as the text table)

It stays keyed by `(lineId, lang, version)`, with title, text, origin, generatable,
skipReason, editedBy, note and history unchanged. A page with no row in a language has no text
there: the site shows `<no text>` and nothing is generated for it.

`pageId`, `bookId`, `pageNumber`, `pageCount`, `ownerKind`, `ownerIds` and `material` keep
being written for one release, so the previous release still reads what it expects, and are
dropped in a later one. `pageId` is an int and cannot hold a minted page, so minting is
switched on only after nothing reads `book_line.pageId` any more.

### A minted page that turns out to be real

When the extract or an import brings in `pageTextID` X whose text matches a minted page:

- The minted page's texts, takes, reports and contributions move to `b:X`, and the minted row
  keeps `aliasOf = 'b:X'`.
- Its audio is renamed in the archive. For one pack cycle the lookup also answers to the old
  name, so packs already installed keep playing.

This is the same fallback the subzone rework plans.

### Book identity

Pages belong to the same book through `bookId`. A minted book's title in a language is its
pages' `book_line.title` there, the same way a translated title works today. `entity_name` is
written only when the book has an owner.

## Matching a contribution

The match is computed whenever it is needed: when triage renders the row, and again when it
is accepted, each time against the corpus as it stands. Once page 1 of a new book is accepted,
the pages after it match that book, with nothing stored in between. Only a moderator's override
is stored, on the contribution, as `matchLineId`, or as `matchBookId` plus `matchPageNumber`.
These replace today's `pageId` column.

The first step that finds a match wins:

1. **Envelope id.** `item=` or `object=` (see the probe) names the owner. `book_page.ownerIds`
   and the page number then give the `lineId`.
2. **Exact text.** The contribution's normalised text equals the current text of exactly one
   page, in any language. This is how Wiley's note is found through esMX.
3. **Title and page number, in the contributor's language.** Exactly one `bookId` has a page
   whose current title in that language matches. If that book has a page at the client's number,
   that page is the match. If not, the match is a new page in that book at that position.
4. **Otherwise, a new book** under that title. Rows still waiting with the same language and
   title are shown together as one pending book.

When step 2 or 3 finds more than one candidate, matching stops and the row waits for a
moderator. A title does not identify a book: two objects are both called "A Dusty Tome".

Each result is one of these kinds:

| kind | meaning | where it goes |
|---|---|---|
| known | same page, same text in that language | dropped at intake, as quests are |
| correction | same page, different text in that language | the books **Corrections** tab, with the diff |
| translation | the page exists but has no text in that language | New |
| new page | an existing book, at a page number it does not have | New |
| new book | nothing matched | New |
| ambiguous | step 2 or 3 found several candidates | New, flagged for the moderator |

### Triage

The "English book" cell on the New tab becomes a **Match** cell that says the result in words,
such as "Translation · Nota de Wiley p.2" or "New book · Instrucciones del consejero Nazgrel
p.1". The picker lists books by their title in any language, plus "New book", next to a page
number. No row is refused for lacking an English page.

## Accepting

| kind | writes |
|---|---|
| translation | a `book_line` row: `lineId`, `lang`, version 1, origin `contributed` |
| correction | a new current version of that language's row, noted with the contribution, as quest corrections are. The diff is against whatever is current, `edited` included, and the moderator decides |
| new page | mints `b:n{uuid}`, then writes a `book_page` row (that `bookId`, the client's page number) and the text |
| new book | mints `bookId` `n{uuid}`, then does what a new page does |

- **Pages never shift.** A page number the book already has would have matched that page at
  step 3, so a new page only ever fills a free number. Gaps are allowed, so p.4 can be accepted
  before p.3.
- **Owner names.** When the owner is known, its name in that language goes into `entity_name`
  only where it has none, as today (`nameIfUnnamed`).
- **Accept all matching** takes only rows whose automatic match is unambiguous. Two rows in one
  batch that write the same page are resolved the way the current insert resolves them: the
  first one to land is kept.

## Packs and the addon

- A language's `Data/Sounds.lua` index (`pipelines/readables/tools/lib/lookup.mjs`) is built from
  `book_page` joined with that language's `book_line`, so minted pages are in it. Each page is
  indexed under the checksum of its current text, and also under the checksum of its extracted
  text when the two differ. Era's wording and Forever's then both play.
- A minted page has no English text, so it is absent from `Spoken_Readables/Data/Books.lua` and from
  the English pack.
- The index lookup in `Reader.lua` (`Find`) can now return a page id that is the string
  `n{uuid}` instead of a number, and its file is `n{uuid}.mp3`. Older addon versions must not
  break on that. The implementation checks every place the addon treats a page id as a number:
  `tonumber`, building `"b:"..id`, sorting or comparing by id, the queue, the report and
  contribution envelopes. If any would fail on a string, minted pages go into a separate index
  table that older versions never read.

## The site

- The catalogue lists every `book_page`. A page with no text in the language being viewed shows
  `<no text>` and is not generated.
- A minted book's title in a language is its page 1 title there. In a language with no title it
  falls back to a language that has one, and is marked as such.

## Probe: does the client say what is being read?

`ItemTextGetItem()` returns a title and `ItemTextGetPage()` a page number. Neither is an id.
Two routes might give one:

- **Item books.** The bag item used just before `ITEM_TEXT_BEGIN` gives an itemID, and
  `item_template.PageText` gives the first page.
- **Gameobject books.** `UnitGUID("softinteract")` may return a `GameObject-…-<entryID>-…` GUID
  while the player is interacting, and `gameobject_template.data0` gives the first page.

The probe was a throwaway debug addon that logged both on `ITEM_TEXT_BEGIN`/`READY`.

### Probe result (Forever, 2026-10-14)

- **Item books:** the used-item hook never fires. Forever's bag buttons, Baganator and Bagnon
  don't go through Lua's `UseContainerItem`, and neither does a `/use` macro. What works on every
  open is searching the bags for an item named like the title (`ItemTextGetItem()`): the
  Encrypted Letter gave item 9555 each time. Two different items with the same name give no
  answer. `GetItemInfo(title)` returns nothing.
- **Gameobject books:** `UnitGUID("npc")` holds `GameObject-…-<entry>-…` on every open, whether
  by mouse or by the interact key, from `ITEM_TEXT_BEGIN` through every page turn. The entry is
  the GUID's sixth field. `softinteract` has it only when the interact key was used.
- **Forever renumbered some objects.** The lectern (175761) matches the corpus. The Khadgar
  plaque is 696299 on Forever and 25333 in vmangos, and was found only because its text
  matched. So an id that names nothing in the corpus is not a new book: matching falls through
  to the words and the title, as before.

Decided on the result: a page may have several owner ids (a renumbered object is added beside
the old one), the addon looks a page up by id first and then by checksum, so current packs keep
working, and a renumbered object whose text also changed is voiced again.

The addon's id-first lookup (an `owners` table in `Books.lua`, `Spoken:BagItemID`, the `npc`
GUID) is built separately on `feat/books-owner-lookup`. The envelope reuses the same two ids.

## Order of work

Stacked PRs. Each one deploys on its own, and every migration is additive
(`deploy/web/bin/migrate.sh`).

1. **Probe.** Done; see the result above.
2. **Migration.** Create `book_page`, backfilled from the current `book_line` rows. Add
   `matchLineId`, `matchBookId`, `matchPageNumber` and `matchNewBook` to `contribution`, with
   today's `pageId` answers copied into `matchLineId`.
3. **Readers move to `book_page`:** catalogue, filters, lookup, export, accept and triage.
4. **Matching, triage, and the new kinds of accept**, including the books Corrections tab.
5. **Addon:** string page ids, plus the envelope ids if the probe found any.
6. **Minting switched on.**
7. **A later release:** drop the structure columns from `book_line`, and drop
   `contribution.pageId`.

## Testing

- **Matcher:** each step, both ambiguous cases, and waiting rows grouping into one pending book.
- **Accept:** each kind, gaps, and two rows of one batch that write the same page.
- **Lookup builder:** minted pages, the two checksums, and a language with pages English lacks.
- **Addon:** a string page id through lookup, queue and envelope, and the separate index if it
  turns out to be needed.
- **Migration backfill:** a row count per language before and after.

Suites run on `spoken_ci_pin`, never `spoken_dev`: the books text tests delete whole languages.

## Not covered here

- **Zones.** Its own spec, including subzone ids built on AreaTable IDs.
- **Getting Nazgrel's real `pageTextID`.** It will come if a later extract or a Forever data
  source includes the book. The alias path above is what absorbs it.
