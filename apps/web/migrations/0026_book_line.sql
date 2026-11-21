-- The books corpus: every page of every book, letter and note, with a history.
--
-- WHY A TABLE, WHEN 0022 SAYS EXTRACTED TEXT IS A FILE. 0022 draws the line at who wrote
-- the words: quest text is Blizzard's and lives in a committed corpus, zone lore is written
-- here and lives in a table. Book text is Blizzard's, so the rule points at a file. It is a
-- table anyway, deliberately: the review path for these lines is the zones one -- read a
-- page, correct what the narrator should say, generate, listen -- and that path needs a
-- live version and a history from the first day rather than after the first regret.
--
-- VERSIONED LIKE lore_line. A re-extract inserts a new version and promotes it only when
-- the current version is itself 'extracted'. Without that, `make readables-import` is a command
-- that silently discards corrections, and therefore one nobody dares run against a corpus
-- somebody has been editing.
--
-- THE STRUCTURAL FIELDS RIDE ALONG because the Lua export has no other input. They are not
-- editable through the app: which pages exist, and in what order, is the extract's business.
-- An API that let a text edit change "pageId" would be one bad request away from a line the
-- addon can never look up.
--
-- EVERY QUERY NAMES ITS LANGUAGE, for the reason lore_line gives: with more than one
-- language "the current version of this line" has two answers, and an unscoped write clears
-- the other language's live flag. Only enUS exists today; vmangos carries eight more
-- translations in locales_page_text, on these same ids.
--
-- Additive and forward-only per deploy/web/bin/migrate.sh: the table is new.

create table "book_line" (
  "id"        bigserial   primary key,

  -- 'b:1381'. pipelines/books/tools/lib/naming.mjs owns the format and nothing else derives
  -- it; AGENTS.md freezes it once a sound pack has shipped.
  "lineId"    text        not null,
  "lang"      text        not null default 'enUS',
  "version"   integer     not null,
  "isCurrent" boolean     not null default false,

  -- 'extracted' came out of the vmangos dump. 'edited' was written by a person here. No
  -- 'translated' yet: nothing produces one, and a value nothing writes is a value somebody
  -- will read as a promise.
  "origin"    text        not null check ("origin" in ('extracted', 'edited')),

  "pageId"     integer    not null,
  -- The chain's first page, which is what a GameObject or item actually points at. Two rows
  -- share a bookId exactly when they are pages of the same book.
  "bookId"     integer    not null,
  "pageNumber" integer    not null,
  "pageCount"  integer    not null,

  -- The owning object's or item's name. Not unique, and not nearly: objects 179547 and
  -- 179548 are both "A Dusty Tome" and hold different text, which is why the addon's lookup
  -- carries a checksum as well as a title.
  "title"     text        not null,
  "ownerKind" text        not null check ("ownerKind" in ('object', 'item')),
  -- Every object or item that opens this book, sorted. More than one is common.
  "ownerIds"  integer[]   not null,
  -- item_template.page_material: the frame the client draws. 0 for GameObject books, whose
  -- material comes from the display rather than the template.
  "material"  integer     not null default 0,

  "text"      text        not null,
  -- Whether this page can be voiced at all, and if not, why. Kept and labelled rather than
  -- dropped, so the explorer can show that the game has a page and say why it is silent.
  -- Recomputed by every extract; see pipelines/books/tools/lib/text.mjs.
  "generatable" boolean   not null default true,
  "skipReason"  text,

  -- Who, and why. Null for extracted rows: no person wrote them.
  "editedBy"  text,
  "note"      text,

  "createdAt" timestamptz not null default now(),

  unique ("lineId", "lang", "version")
);

-- Exactly one live version per line per language, enforced rather than trusted, for the
-- reason lore_line_current_idx exists: two rows claiming to be current make the export
-- ambiguous, and the export is what the addon ships.
create unique index "book_line_current_idx"
  on "book_line" ("lineId", "lang") where "isCurrent";

-- The history panel's query, and the export's ordering.
create index "book_line_line_idx" on "book_line" ("lineId", "lang", "version" desc);

-- The explorer lists pages under their book, which is this ordering exactly.
create index "book_line_book_idx" on "book_line" ("bookId", "pageNumber") where "isCurrent";
