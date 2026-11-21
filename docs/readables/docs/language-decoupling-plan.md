# Books without English — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A books page can exist in any language. A contribution from any client is matched to its page automatically, and accepting it writes a translation, a correction, a new page or a new book. A language's pack can then play that page.

**Architecture:** A new `book_page` table holds identity and structure. `book_line` stays the per-language text table. A single matcher (`lib/contributions/book-match.ts`) decides what a books contribution is: known, correction, translation, new page, new book or ambiguous. Triage, intake, the corrections tab and accept all ask it. A page the game never named gets `b:n{uuid}`. Packs carry their own index and page placement for pages the English data module lacks, in tables older addon versions never read.

**Tech Stack:** Postgres migrations (`apps/web/migrations`), Next.js/TypeScript with vitest (`apps/web`), Node ESM pipeline (`pipelines/readables/tools`, `node --test`), Lua 5.1 addon with luajit tests (`tests/lua`), one Python importer (`pipelines/quests/tools/import_questit.py`).

**Spec:** `docs/readables/docs/language-decoupling.md`

## Global Constraints

- Migrations are additive and forward-only. A release must run against the schema of the release after it (`deploy/web/bin/migrate.sh`).
- An extracted page keeps `lineId` `b:{pageTextID}` and its audio file name. Both are frozen (`docs/readables/AGENTS.md`).
- A minted page id is `b:n{uuid}` and a minted book id is `n{uuid}`, with `uuid` from `crypto.randomUUID()`.
- `pageChecksum`'s constants do not change.
- Mail is never captured (`docs/readables/AGENTS.md`).
- Web suites and pipeline tests run against `spoken_ci_pin`, never `spoken_dev`: `set -x DATABASE_URL postgres:///spoken_ci_pin` in the shell running them. The books text tests delete whole languages.
- The user's shell is fish. Every command given to the user is in fish syntax.
- Comments match the surrounding code: say what the code does, not its history, and don't point at sibling files for context.
- PR descriptions follow the user's guideline: about 200 words of prose, no change lists, and no Claude attribution line.
- Tests run before each commit and push: `make web-test` for `apps/web`, `make readables-test` for the pipeline, `make test-player` for Lua.

## Review Focus

1. **A contribution whose title is shared by several books** (e.g. "A Dusty Tome"). Expected: `ambiguous`, never a guess. Pinned in Task 6.
2. **Two new-book rows with the same title accepted in one batch.** Expected: one minted book holding both pages, not two books. Pinned in Task 8.
3. **An older addon with a new language pack that has minted pages.** Expected: older versions neither error nor claim the page; they show Contribute as they do today. Pinned in Task 11 (the pack keeps minted pages out of `index`/`loose`) and Task 12.
4. **An English client contributing a page the corpus lacks.** Expected: it goes through the same matcher and can mint, where today English rows write nothing. Pinned in Task 8.
5. **A correction accepted, then the same text sent again.** Expected: `known`, dropped at intake, never a second correction. Pinned in Task 9.

---

## PR 0: probe (throwaway, needs the user in game)

### Task 0: Does the client say what is being read? (done 2026-10-14, result in the spec)

**Files:**
- Create (not committed): `addons/Spoken_Books/Probe.lua`, plus a temporary line in `addons/Spoken_Books/Spoken_Books.toc`.

- [ ] **Step 1: Write the probe**

```lua
-- THROWAWAY. Logs what the client knows about a readable when it opens.
local ADDON_NAME, SpokenBooks = ...

local lastBagItem
hooksecurefunc(C_Container and C_Container.UseContainerItem and C_Container or _G,
	C_Container and C_Container.UseContainerItem and "UseContainerItem" or "UseContainerItem",
	function(bag, slot)
		local getID = C_Container and C_Container.GetContainerItemID or GetContainerItemID
		lastBagItem = { id = getID and getID(bag, slot), at = GetTime() }
	end)

local frame = CreateFrame("Frame")
frame:RegisterEvent("ITEM_TEXT_BEGIN")
frame:RegisterEvent("ITEM_TEXT_READY")
frame:SetScript("OnEvent", function(_, event)
	local soft = UnitGUID and UnitGUID("softinteract")
	local npc = UnitGUID and UnitGUID("npc")
	local item = lastBagItem and (GetTime() - lastBagItem.at) < 2 and lastBagItem.id
	print(format("|cff88ccff[probe]|r %s title=%s page=%s bagItem=%s softinteract=%s npc=%s",
		event, tostring(ItemTextGetItem and ItemTextGetItem()), tostring(ItemTextGetPage and ItemTextGetPage()),
		tostring(item), tostring(soft), tostring(npc)))
end)
```

Add `Probe.lua` as the last line of `Spoken_Books.toc`, then symlink this worktree into the client with `/link-addon forever` (and `era` for Era).

- [ ] **Step 2: The user reads three books in Forever and in Era, and pastes the chat lines**

- an item book from the bags: Nota de Wiley / "Wiley's Note"
- a gameobject book: a lectern or a book on a table
- a page opened from a quest reward or a quest log item

- [ ] **Step 3: Record the result**

Add a short "Probe result (2026-10-xx)" paragraph to the spec's probe section: which fields were reliable and on which clients. Then delete `Probe.lua` and revert the `.toc`.

What follows from the result:
- `bagItem` reliable on item books: Task 12 sends `item=`, and Task 6's step 1 matches owners of kind `item`.
- `softinteract` gives a `GameObject-…-<entry>-…` GUID: Task 12 sends `object=` (the entry id is the GUID's sixth `-`-separated field), and Task 6 matches owners of kind `object`.
- Neither: Task 12 sends no ids, and Task 6's step 1 stays in the code but never fires. No other task changes.

- [ ] **Step 4: Commit the spec note only**

```fish
git add docs/readables/docs/language-decoupling.md
git commit -m "Books: what the client says about a readable it opens"
```

---

## PR 1: `book_page`, and every writer keeping it in step

### Task 1: Migration — `book_page` and the contribution's match

**Files:**
- Create: `apps/web/migrations/0074_book_page.sql`
- Test: `apps/web/src/lib/readables/book-page.test.ts`

**Interfaces:**
- Produces: table `book_page("lineId" text pk, "pageTextId" int null, "bookId" text not null, "pageNumber" int not null, "ownerKind" text null, "ownerIds" int[] null, "material" int null, "aliasOf" text null references book_page)`, unique `("bookId", "pageNumber") where "aliasOf" is null`. Columns on `contribution`: `"matchLineId" text`, `"matchBookId" text`, `"matchPageNumber" int`, `"matchNewBook" boolean not null default false`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * book_page holds every page book_line has, in the same place.
 *
 * Needs DATABASE_URL and migrations applied (0074).
 */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

afterAll(closeDb);

describe("book_page", () => {
  it("has a row for every page book_line has", async () => {
    const { rows } = await db().query<{ missing: number }>(
      `select count(*)::int as "missing" from (select distinct "lineId" from "book_line") l
        where not exists (select 1 from "book_page" p where p."lineId" = l."lineId")`,
    );
    expect(rows[0].missing).toBe(0);
  });

  it("places each extracted page where its English row does", async () => {
    const { rows } = await db().query<{ moved: number }>(
      `select count(*)::int as "moved" from "book_line" b join "book_page" p using ("lineId")
        where b."lang" = 'enUS' and b."isCurrent"
          and (p."bookId" <> b."bookId"::text or p."pageNumber" <> b."pageNumber"
               or p."pageTextId" <> b."pageId")`,
    );
    expect(rows[0].moved).toBe(0);
  });

  it("refuses two live pages at one place in one book", async () => {
    const bookId = `test-${Math.random().toString(36).slice(2)}`;
    await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`, [`b:n${bookId}a`, bookId]);
    await expect(
      db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`, [`b:n${bookId}b`, bookId]),
    ).rejects.toThrow(/book_page_place/);
    await db().query(`delete from "book_page" where "bookId" = $1`, [bookId]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/readables/book-page.test.ts`
Expected: FAIL, `relation "book_page" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- Which pages exist, where each sits, and what opens it -- the same in every language.
--
-- book_line keeps each language's words for a page. Until now it also carried the page's
-- structure on every row, copied from the English one, so a page English does not have could
-- not exist in any language. book_page is that structure, once per page.
--
-- "lineId" is 'b:{pageTextID}' for a page the world database has, or 'b:n{uuid}' for one a
-- player's client showed and nothing else names. "bookId" is text for the same reason: the
-- first page's pageTextID, or 'n{uuid}'. A book's page count is the count of its pages, so it
-- is not stored.
--
-- "aliasOf" is set on a minted page later found in the world database: everything moved to the
-- real page, and the minted id is kept so a pack that shipped it still plays.
--
-- Additive: book_line keeps its structure columns, written and read as before, until a later
-- release drops them.

create table "book_page" (
  "lineId"     text primary key,
  "pageTextId" integer,
  "bookId"     text    not null,
  "pageNumber" integer not null,
  "ownerKind"  text    check ("ownerKind" in ('object', 'item')),
  "ownerIds"   integer[],
  "material"   integer,
  "aliasOf"    text    references "book_page" ("lineId"),
  "createdAt"  timestamptz not null default now()
);

-- One live page per place in a book. Deferred, so a re-extract that swaps two pages of one book
-- writes both before it is checked.
alter table "book_page" add constraint "book_page_place"
  exclude using btree ("bookId" with =, "pageNumber" with =) where ("aliasOf" is null)
  deferrable initially deferred;
create index "book_page_owner" on "book_page" using gin ("ownerIds");

-- Every page book_line has, placed as its English row places it, or failing that its
-- lowest-language current row.
insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds", "material")
select distinct on ("lineId")
       "lineId", "pageId", "bookId"::text, "pageNumber", "ownerKind", "ownerIds", "material"
  from "book_line"
 where "isCurrent"
 order by "lineId", ("lang" = 'enUS') desc, "lang";

-- A moderator's answer to "which page is this?", replacing "pageId": a page in any language, a
-- place in a book, or a new book. All null and false when nobody has answered.
alter table "contribution" add column if not exists "matchLineId" text;
alter table "contribution" add column if not exists "matchBookId" text;
alter table "contribution" add column if not exists "matchPageNumber" integer;
alter table "contribution" add column if not exists "matchNewBook" boolean not null default false;

update "contribution" set "matchLineId" = 'b:' || "pageId"
 where "pageId" is not null and "matchLineId" is null;
```

- [ ] **Step 4: Apply it and run the test**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; deploy/web/bin/migrate.sh $PWD/apps/web; and pnpm --filter web exec vitest run src/lib/readables/book-page.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```fish
git add apps/web/migrations/0074_book_page.sql apps/web/src/lib/readables/book-page.test.ts
git commit -m "Books: book_page, a page's place in its book once for every language"
```

### Task 2: Writers keep `book_page` in step

Every writer that can create a page now writes `book_page` in the same transaction. Writers that only add text to an existing page are unchanged in this PR.

**Files:**
- Modify: `pipelines/readables/tools/import.mjs` (the insert loop and the structural update)
- Modify: `pipelines/readables/tools/import-locale.mjs` (the comment on `withoutEnglish` only; see below)
- Modify: `make/web.mk:154-166` (`migrate-readables`), `make/readables.mk:84` (`sync`)
- Create: `pipelines/readables/tools/lib/page.mjs`
- Test: `pipelines/readables/tools/lib/page.test.mjs`

**Interfaces:**
- Produces: `bookPageUpsert(entry) -> { text: string, values: unknown[] }` in `lib/page.mjs`, the SQL that inserts or moves an extracted page's `book_page` row.

`import-locale.mjs` keeps skipping locale pages that have no English row. A `locales_page_text` entry is a `page_text` entry, and the English extract already holds every `page_text` entry something can open. A locale page the extract lacks is one of the orphans `docs/readables/README.md` counts ("66 pages … which nothing can open"). Update the spec's "Order of work" step 3 sentence to match.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { bookPageUpsert } from "./page.mjs";

test("an extracted page is written under its own id, its book as text", () => {
  const { text, values } = bookPageUpsert({
    lineId: "b:1381", pageId: 1381, bookId: 1380, pageNumber: 2,
    ownerKind: "item", ownerIds: [5], material: 1,
  });
  assert.match(text, /insert into "book_page"/);
  assert.match(text, /on conflict \("lineId"\) do update/);
  assert.deepEqual(values, ["b:1381", 1381, "1380", 2, "item", [5], 1]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test pipelines/readables/tools/lib/page.test.mjs`
Expected: FAIL, `Cannot find module './page.mjs'`.

- [ ] **Step 3: Write `lib/page.mjs`**

```js
// The structure half of a page: its row in book_page, as the extract places it.

/**
 * Inserts an extracted page's book_page row, or moves it where the extract now places it.
 *
 * @param entry an extract entry: lineId, pageId, bookId, pageNumber, ownerKind, ownerIds, material
 */
export function bookPageUpsert(entry) {
  return {
    text: `insert into "book_page"
             ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds", "material")
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict ("lineId") do update
             set "pageTextId" = excluded."pageTextId", "bookId" = excluded."bookId",
                 "pageNumber" = excluded."pageNumber", "ownerKind" = excluded."ownerKind",
                 "ownerIds" = excluded."ownerIds", "material" = excluded."material"`,
    values: [
      entry.lineId, entry.pageId, String(entry.bookId), entry.pageNumber,
      entry.ownerKind, entry.ownerIds, entry.material,
    ],
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test pipelines/readables/tools/lib/page.test.mjs`
Expected: PASS.

- [ ] **Step 5: Call it from `import.mjs`**

In `import.mjs`, import it next to `decideImport`:

```js
import { bookPageUpsert } from "./lib/page.mjs";
```

Then, as the first statement inside the `for (const entry of entries)` loop, before reading `current`:

```js
    // Where the page sits, whatever its text does: the extract owns structure.
    const placed = bookPageUpsert(entry);
    await pool.query(placed.text, placed.values);
```

Two pages of the same book that swap numbers in one re-extract would collide on `book_page_place` halfway through. The constraint is deferred (Task 1), so run every `book_page` upsert in one transaction and the check runs at commit: open a client before the loop, `begin`, use `client.query` for the upsert, and `commit` after the loop. Leave the per-line text transactions on their own clients as they are.

- [ ] **Step 6: Sync and migrate both tables**

`make/readables.mk`, in `sync`:

```make
	@$(DB_ENV) scripts/db/sync-section.sh books book_line book_page
```

`make/web.mk`, in `migrate-readables`: truncate both, then dump both.

```make
	@( echo 'begin;'; \
	   echo 'truncate "book_line", "book_page";'; \
	   pg_dump "$(LOCAL_DB)" --data-only --table=book_page --table=book_line | $(UNRESTRICT); \
```

Leave the sequence reset line as it is (`book_page` has no sequence). `--table=book_page` comes first so that `aliasOf`'s references load before they are needed, though `pg_dump` orders by dependency anyway.

- [ ] **Step 7: Run the pipeline tests against a fresh import**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; make readables-test; and node pipelines/readables/tools/import.mjs; and psql spoken_ci_pin -tAc 'select count(*) from book_page'`
Expected: tests pass. The import reports `0 promoted … unchanged`, and the count equals `select count(distinct "lineId") from book_line`.

- [ ] **Step 8: Commit**

```fish
git add pipelines/readables/tools/lib/page.mjs pipelines/readables/tools/lib/page.test.mjs pipelines/readables/tools/import.mjs make/readables.mk make/web.mk docs/readables/docs/language-decoupling.md
git commit -m "Books: the import places pages in book_page, and sync carries it"
```

---

## PR 2: readers move to `book_page`

### Task 3: Page keys and file names that are not numbers

**Files:**
- Modify: `pipelines/readables/tools/lib/naming.mjs`
- Modify: `apps/web/src/lib/readables/tools.ts:44-45`
- Test: `pipelines/readables/tools/lib/naming.test.mjs`

**Interfaces:**
- Produces: `pageKeyOf(lineId: string) -> string` ('b:1381' gives '1381', 'b:n…' gives 'n…'); `lineIdOfKey(key: string) -> string | null` (null unless the key is all digits or `n` followed by a uuid); `fileFor(pageIdOrKey: number | string) -> string` (unchanged for numbers); `mintPageId() -> string` ('b:n' + uuid); `mintBookId() -> string` ('n' + uuid); `isMinted(lineId: string) -> boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `naming.test.mjs`:

```js
import { fileFor, isMinted, lineIdOfKey, mintBookId, mintPageId, pageKeyOf } from "./naming.mjs";

test("a page key is the lineId without its section", () => {
  assert.equal(pageKeyOf("b:1381"), "1381");
  assert.equal(pageKeyOf("b:n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"), "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11");
});

test("only a number or a minted id is a key", () => {
  assert.equal(lineIdOfKey("1381"), "b:1381");
  assert.equal(lineIdOfKey("n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"), "b:n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11");
  assert.equal(lineIdOfKey("../etc"), null);
  assert.equal(lineIdOfKey("n123"), null);
});

test("a minted page is filed under its key", () => {
  assert.equal(fileFor(1381), "1381");
  assert.equal(fileFor("n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"), "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11");
});

test("minted ids never look like a page the world database has", () => {
  assert.match(mintPageId(), /^b:n[0-9a-f-]{36}$/);
  assert.match(mintBookId(), /^n[0-9a-f-]{36}$/);
  assert.equal(isMinted(mintPageId()), true);
  assert.equal(isMinted("b:1381"), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test pipelines/readables/tools/lib/naming.test.mjs`
Expected: FAIL, `pageKeyOf is not a function`.

- [ ] **Step 3: Implement in `naming.mjs`**

Change the import to `import { createHash, randomUUID } from "node:crypto";`. Replace `fileFor` and add the rest below `lineIdFor`:

```js
const MINTED = /^n[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Store-relative and extension-less: '1381', or a minted page's key. */
export function fileFor(pageIdOrKey) {
  return String(pageIdOrKey);
}

/** '1381' for 'b:1381', 'n{uuid}' for a minted page: what the addon and the landing URL use. */
export function pageKeyOf(lineId) {
  return lineId.slice(2);
}

/** The lineId a key names, or null for anything that is not a page id or a minted one. */
export function lineIdOfKey(key) {
  return /^\d+$/.test(key) || MINTED.test(key) ? `b:${key}` : null;
}

/** A page no world database names, as a player's client showed it. */
export function mintPageId() {
  return `b:n${randomUUID()}`;
}

/** A book made of such pages. */
export function mintBookId() {
  return `n${randomUUID()}`;
}

export function isMinted(lineId) {
  return MINTED.test(pageKeyOf(lineId));
}
```

In `apps/web/src/lib/readables/tools.ts`, replace the `fileFor` export and add the rest:

```ts
/** Store-relative and extension-less, e.g. '1381'. AGENTS.md freezes it for extracted pages. */
export const fileFor = namingModule.fileFor as (pageIdOrKey: number | string) => string;

/** '1381' for 'b:1381'; a minted page's 'n{uuid}'. */
export const pageKeyOf = namingModule.pageKeyOf as (lineId: string) => string;

/** The lineId a key names, or null for anything else. */
export const lineIdOfKey = namingModule.lineIdOfKey as (key: string) => string | null;

export const mintPageId = namingModule.mintPageId as () => string;
export const mintBookId = namingModule.mintBookId as () => string;
export const isMinted = namingModule.isMinted as (lineId: string) => boolean;
```

- [ ] **Step 4: Run the tests**

Run: `node --test pipelines/readables/tools/lib/naming.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```fish
git add pipelines/readables/tools/lib/naming.mjs pipelines/readables/tools/lib/naming.test.mjs apps/web/src/lib/readables/tools.ts
git commit -m "Books: page keys and minted ids, beside the frozen numeric ones"
```

### Task 4: The catalogue reads `book_page`, and English is one language

**Files:**
- Modify: `apps/web/src/lib/readables/catalogue.ts` (`BookPage`, `stampOf`, `buildTranslated`, `build`, `pageById`, `BookFacet`, `bookFacets`)
- Modify: `apps/web/src/lib/readables/search.ts:23-24,89-90,142,164`
- Modify: `apps/web/src/lib/readables/filters.ts:34,93,113-119,137`
- Modify: `apps/web/src/components/readables/SearchBar.tsx:75,101-103`, `apps/web/src/components/readables/Player.tsx:45`, `apps/web/src/components/readables/BookList.tsx:58` (type only)
- Modify: `apps/web/src/app/[lang]/readables/r/[pageId]/page.tsx:36,114`, `apps/web/src/app/api/reports/route.ts:139`, `apps/web/src/lib/reports/detail.ts:51`
- Test: `apps/web/src/lib/readables/catalogue.test.ts` (new), `apps/web/src/lib/readables/search.test.ts` (update fixtures)

**Interfaces:**
- Consumes: `fileFor`, `pageKeyOf`, `lineIdOfKey` from Task 3.
- Produces: `BookPage` with `pageId: number | null`, `key: string`, `bookId: string`, and `missing` present in English too. `pageById(key: string, lang)`. `BookFacet.bookId: string`. `BookFilters.bookId?: string`.

What changes in `BookPage`:

```ts
export type BookPage = {
  /** 'b:1381' or 'b:n{uuid}'. naming.mjs owns the format. */
  id: string;
  /** '1381' or 'n{uuid}': the landing URL's and the addon's name for the page. */
  key: string;
  /** The world database's pageTextID; null for a page only a player's client has shown. */
  pageId: number | null;
  /** Two pages share it exactly when they are one book. */
  bookId: string;
  pageNumber: number;
  pageCount: number;
  title: string;
  ownerKind: OwnerKind | null;
  ownerIds: number[];
  material: number;
  text: string;
  spoken: string;
  hash: string;
  file: string;
  generatable: boolean;
  skipReason: string | null;
  /** What this language has not written; another language's words stand in, marked. */
  missing?: { text: boolean; title: boolean };
  /** The English page, for a translator to work from. Absent when reading English. */
  english?: string;
  englishTitle?: string;
};
```

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/readables/catalogue.test.ts`:

```ts
/**
 * The catalogue lists every page book_page has, in each language, whether that language has
 * words for it or not.
 *
 * Needs DATABASE_URL and migrations applied (0074).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { catalogue, pageById } from "./catalogue";

const run = Math.random().toString(36).slice(2, 10);
const bookId = `n00000000-0000-4000-8000-${run.padEnd(12, "0")}`;
const lineId = `b:${bookId}`;

beforeAll(async () => {
  await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`, [lineId, bookId]);
  await db().query(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId", "pageNumber",
        "pageCount", "title", "ownerKind", "ownerIds", "text")
     values ($1, 'esES', 1, true, 'contributed', 0, 0, 1, 1, 'Instrucciones', 'item', '{}', 'Trotamundos.')`,
    [lineId],
  );
});

afterAll(async () => {
  await db().query(`delete from "book_line" where "lineId" = $1`, [lineId]);
  await db().query(`delete from "book_page" where "lineId" = $1`, [lineId]);
  await closeDb();
});

describe("catalogue", () => {
  it("lists a page English lacks in English, without words", async () => {
    const page = (await catalogue("enUS")).find((p) => p.id === lineId);
    expect(page).toMatchObject({ key: bookId, pageId: null, generatable: false, missing: { text: true } });
    expect(page?.text).toBe("");
    expect(page?.title).toBe("Instrucciones");
  });

  it("lists it in its own language with its words", async () => {
    const page = (await catalogue("esES")).find((p) => p.id === lineId);
    expect(page).toMatchObject({ text: "Trotamundos.", title: "Instrucciones" });
    expect(page?.missing).toBeUndefined();
  });

  it("finds it by its key", async () => {
    expect((await pageById(bookId, "esES"))?.id).toBe(lineId);
    expect(await pageById("../x", "esES")).toBeUndefined();
  });
});
```

The `book_line` insert fills the structure columns with placeholders because they are still `not null` in this PR. Task 8's migration relaxes them, and Task 8 then drops these placeholders from the fixture.

- [ ] **Step 2: Run it to see it fail**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/readables/catalogue.test.ts`
Expected: FAIL. The page is absent from the English catalogue (`page` is undefined).

- [ ] **Step 3: Rewrite `build` around `book_page`**

Replace `stampOf`, `buildTranslated` and `build` with one builder that serves every language:

```ts
async function stampOf(lang: Lang): Promise<string> {
  const rows = await query<{ stamp: string }>(
    `select ${versionStamp("book_line", `"lang" = $1`)} || '|' ||
            ${versionStamp("book_line", `"lang" = '${BASE_LANG}'`)} || '|' ||
            (select count(*) || ':' || coalesce(max("createdAt")::text, '') from "book_page") || '|' ||
            ${nameStamp(["item", "gameobject"])} as "stamp"`,
    [lang],
  );
  return rows[0]?.stamp ?? "";
}

type PageRow = {
  lineId: string;
  pageTextId: number | null;
  bookId: string;
  pageNumber: number;
  pageCount: number;
  ownerKind: OwnerKind | null;
  ownerIds: number[] | null;
  material: number | null;
  text: string | null;
  title: string | null;
  englishText: string | null;
  englishTitle: string | null;
  /** Any language's title, for a page neither this language nor English names. */
  anyTitle: string | null;
};

/**
 * Every page that exists, with this language's words where it has them. Where it has none, the
 * page is still listed -- its place is a fact about the world -- with English, or any language,
 * standing in, marked `missing`, and never voiced.
 *
 * A title is the owner's name in entity_name when the page has an owner, and otherwise the
 * page's own book_line title, as for a page a player's client showed.
 */
async function build(lang: Lang): Promise<BookPage[]> {
  const [rows, names] = await Promise.all([
    query<PageRow>(
      `select p."lineId", p."pageTextId", p."bookId", p."pageNumber",
              count(*) over (partition by p."bookId")::int as "pageCount",
              p."ownerKind", p."ownerIds", p."material",
              l."text", l."title", e."text" as "englishText", e."title" as "englishTitle",
              (select a."title" from "book_line" a
                where a."lineId" = p."lineId" and a."isCurrent" order by a."lang" limit 1) as "anyTitle"
         from "book_page" p
         left join "book_line" l on l."lineId" = p."lineId" and l."lang" = $1 and l."isCurrent"
         left join "book_line" e on e."lineId" = p."lineId" and e."lang" = $2 and e."isCurrent"
        where p."aliasOf" is null
        order by p."bookId", p."pageNumber"`,
      [lang, BASE_LANG],
    ),
    query<{ kind: string; entityId: string; name: string }>(
      `select "kind", "entityId", "name" from "entity_name"
        where "lang" = $1 and "kind" in ('item', 'gameobject') and "isCurrent"`,
      [lang],
    ),
  ]);
  if (rows.length === 0) throw new CorpusEmpty(lang);
  const owned = new Map(names.map((row) => [`${row.kind}:${row.entityId}`, row.name]));

  // A minted book's title is its first page's, so every page of it reads under one name.
  const firstTitle = new Map<string, string | null>();
  for (const row of rows) if (!firstTitle.has(row.bookId)) firstTitle.set(row.bookId, row.title);

  return rows.map((row) => {
    const ownerIds = row.ownerIds ?? [];
    const ownerName = row.ownerKind && ownerIds.length
      ? owned.get(`${ownerEntityKind(row.ownerKind)}:${ownerIds[0]}`)
      : undefined;
    const own = lang === BASE_LANG && row.ownerKind ? row.englishTitle ?? undefined : ownerName;
    const title = own ?? firstTitle.get(row.bookId) ?? row.title ?? undefined;
    const shown = title ?? row.englishTitle ?? row.anyTitle ?? "";
    const base = {
      id: row.lineId,
      key: pageKeyOf(row.lineId),
      pageId: row.pageTextId,
      bookId: row.bookId,
      pageNumber: row.pageNumber,
      pageCount: row.pageCount,
      title: shown,
      ownerKind: row.ownerKind,
      ownerIds,
      material: row.material ?? 0,
      file: fileFor(pageKeyOf(row.lineId)),
      ...(lang !== BASE_LANG && { english: row.englishText ?? "", englishTitle: row.englishTitle ?? "" }),
    };
    if (row.text === null) {
      return {
        ...base,
        text: row.englishText ?? "",
        spoken: "",
        hash: textHash(""),
        generatable: false,
        skipReason: "untranslated",
        missing: { text: true, title: title === undefined },
      };
    }
    return {
      ...base,
      text: row.text,
      ...voiced(row.text, lang, spokenTitle(row.pageNumber, title)),
      ...(title === undefined && { missing: { text: false, title: true } }),
    };
  });
}
```

Notes for the implementer:
- English titles: an extracted English page's `book_line.title` is the owner's English name, which is what English showed before, so English keeps reading it (`own` above).
- `text: row.englishText ?? ""` keeps today's behaviour where English stands in for an untranslated page. A page English lacks shows `""`, and the explorer renders `<no text>` for it (Task 5).
- `fileFor(pageKeyOf(lineId))` gives `"1381"` for an extracted page, the same as `fileFor(1381)` today.

Replace `pageById`:

```ts
/** One page, by the key the addon and the landing URL know it as: '1381' or 'n{uuid}'. */
export async function pageById(key: string, lang: Lang = BASE_LANG): Promise<BookPage | undefined> {
  const lineId = lineIdOfKey(key);
  if (!lineId) return undefined;
  return (await catalogue(lang)).find((page) => page.id === lineId);
}
```

Change `BookFacet` to `{ bookId: string; title: string; pages: number; ownerKind: OwnerKind | null }`, and in `bookFacets`, the `Map<string, BookFacet>` and the tiebreak `a.bookId.localeCompare(b.bookId)`.

Update the imports: `import { spokenText, spokenHash, textHash, fileFor, isGeneratable, spokenWithTitle, pageKeyOf, lineIdOfKey } from "./tools";`.

- [ ] **Step 4: Follow the types through**

Run `pnpm --filter web typecheck` and fix each error with these exact changes:
- `search.ts`: `pageId: number | null; key: string; bookId: string;` in its line type, copy `key: page.key` next to `pageId`, and change the sort's `a.bookId - b.bookId` to `a.bookId.localeCompare(b.bookId, undefined, { numeric: true })`. `numeric` keeps extracted books in today's numeric order.
- `filters.ts`: `bookId?: string;`. Parse with `const book = params.get("book"); bookId: book && /^(\d+|n[0-9a-f-]{36})$/.test(book) ? book : undefined`. Serialise with `params.set("book", filters.bookId)`.
- `SearchBar.tsx`: `value: book.bookId` and `onChange({ bookId: value || undefined })`.
- `Player.tsx:45`: `${line.key}` instead of `${line.pageId}`.
- `books/r/[pageId]/page.tsx:36`: `pageById(pageId, lang)`, with the ReportForm `target={page.key}`.
- `api/reports/route.ts:139`: `const page = await pageById(raw);`.
- `reports/detail.ts:51`: `books: (line) => (line as BookLine).key,`.
- `search.test.ts`: in every fixture page, `bookId: "…"` as a string and an added `key` equal to the numeric id as a string.

- [ ] **Step 5: Run the books and reports suites**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/readables src/app/api/reports src/lib/reports`
Expected: PASS, the new `catalogue.test.ts` included.

- [ ] **Step 6: Commit**

```fish
git add -A apps/web/src/lib/readables apps/web/src/components/readables apps/web/src/app/[lang]/readables apps/web/src/app/api/reports apps/web/src/lib/reports
git commit -m "Books: the catalogue lists every page in every language, English included"
```

### Task 5: `<no text>` in the explorer

**Files:**
- Modify: `apps/web/src/components/readables/PageRow.tsx:184-186`
- Create: `apps/web/src/lib/readables/shown.ts`
- Test: `apps/web/src/lib/readables/shown.test.ts`

**Interfaces:**
- Consumes: `BookPage.missing.text` and `BookPage.text === ""` from Task 4.
- Produces: `shownText(line: { text: string; missing?: { text: boolean } }) -> string`.

The repo has no React Testing Library, so the rule goes in a pure helper with a plain test.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { NO_TEXT, shownText } from "./shown";

describe("shownText", () => {
  it("says a page has no words in this language when nothing stands in", () => {
    expect(shownText({ text: "", missing: { text: true } })).toBe(NO_TEXT);
    expect(NO_TEXT).toBe("<no text>");
  });

  it("keeps the words that stand in, and the page's own", () => {
    expect(shownText({ text: "English words.", missing: { text: true } })).toBe("English words.");
    expect(shownText({ text: "Palabras." })).toBe("Palabras.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter web exec vitest run src/lib/readables/shown.test.ts`
Expected: FAIL, cannot resolve `./shown`.

- [ ] **Step 3: Implement, and use it in `PageRow.tsx`**

`apps/web/src/lib/readables/shown.ts`:

```ts
/** What the explorer shows for a page no language it can borrow from has words for. */
export const NO_TEXT = "<no text>";

/** A page's words as the explorer shows them. */
export function shownText(line: { text: string; missing?: { text: boolean } }): string {
  return line.missing?.text && line.text === "" ? NO_TEXT : line.text;
}
```

`PageRow.tsx`, line 185:

```tsx
            <Untranslated missing={line.missing?.text}>{shownText(line)}</Untranslated>
```

with `import { shownText } from "@/lib/readables/shown";`.

- [ ] **Step 4: Run it to see it pass, then commit**

Run: `pnpm --filter web exec vitest run src/lib/readables/shown.test.ts; and pnpm --filter web typecheck`
Expected: PASS.

```fish
git add apps/web/src/lib/readables/shown.ts apps/web/src/lib/readables/shown.test.ts apps/web/src/components/readables/PageRow.tsx
git commit -m "Books: a page with no words in this language says so"
```

### Task 5b: Pipeline readers — export, lookup, text writers

**Files:**
- Modify: `pipelines/readables/tools/export.mjs:30-36`
- Modify: `pipelines/readables/tools/lib/lookup.mjs:133-160` (the clips query and the locale pages query)
- Modify: `apps/web/src/lib/readables/text.ts:105-120,150-163` (`saveBookText`'s first-translation source)
- Modify: `pipelines/quests/tools/import_questit.py:139-151`
- Test: `apps/web/src/lib/readables/text.test.ts`, `pipelines/readables/tools/lib/lookup.test.mjs`

**Interfaces:**
- Consumes: `book_page`.
- Produces: `saveBookText` can write the first text of a page in any language, English included, as long as the page has a `book_page` row.

- [ ] **Step 1: Write the failing test** in `text.test.ts`

```ts
it("writes the first words of a page English lacks", async () => {
  const lineId = `b:n00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
  await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`, [lineId, lineId.slice(2)]);
  const saved = await saveBookText({ lineId, text: "Hola.", editedBy: USER, lang: "esES" });
  expect(saved).toMatchObject({ lineId, version: 1, text: "Hola." });
  await db().query(`delete from "book_line" where "lineId" = $1`, [lineId]);
  await db().query(`delete from "book_page" where "lineId" = $1`, [lineId]);
});
```

Use the file's existing user fixture for `USER`.

- [ ] **Step 2: Run it to see it fail**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/readables/text.test.ts`
Expected: FAIL, `BookMissing: … is not in book_line`.

- [ ] **Step 3: Take a first text's structure from `book_page`**

In `saveBookText`, replace the "first translation" lookup and the insert's `select … from "book_line"` with a `book_page` source. The structure columns are still written, from `book_page`, until they are dropped:

```ts
    const { rows: placed } = await client.query<{ lineId: string }>(
      `select "lineId" from "book_page" where "lineId" = $1`,
      [args.lineId],
    );
    if (!current && !placed[0]) {
      throw new BookMissing(`${args.lineId} is not a page -- seed the table with: make readables-import`);
    }
```

The insert becomes:

```ts
    const { rows: inserted } = await client.query<Row>(
      `insert into "book_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
          "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
          "text", "generatable", "skipReason", "editedBy", "note")
       select p."lineId", $2, $3, true, 'edited', p."pageTextId", ${BOOK_ID_COMPAT}, p."pageNumber",
              (select count(*) from "book_page" c where c."bookId" = p."bookId" and c."aliasOf" is null),
              coalesce(t."title", e."title", ''), p."ownerKind", p."ownerIds", coalesce(p."material", 0),
              $4, $7, $8, $5, $6
         from "book_page" p
         left join "book_line" t on t."lineId" = p."lineId" and t."lang" = $2 and t."isCurrent"
         left join "book_line" e on e."lineId" = p."lineId" and e."lang" = '${BASE_LANG}' and e."isCurrent"
        where p."lineId" = $1
       returning ${COLUMNS}`,
      [args.lineId, lang, version, text, args.editedBy, args.note?.trim() || null, generatable, skipReason],
    );
```

with, near the top of the module:

```ts
/**
 * book_line's integer bookId, written until the column is dropped: the extracted book's id,
 * or null for a minted book once the column allows it.
 */
const BOOK_ID_COMPAT = `case when p."bookId" ~ '^\\d+$' then p."bookId"::int end`;
```

Remove the now-unused `source` variable and the update that clears `isCurrent`'s dependence on it. The clear itself stays.

- [ ] **Step 4: `export.mjs` and `lookup.mjs` read structure from `book_page`**

`export.mjs`'s query (English only, for `Spoken_Books/Data/Books.lua`):

```js
  const { rows } = await pool.query(
    `select p."pageTextId" as "pageId", p."bookId"::int as "bookId", p."pageNumber",
            count(*) over (partition by p."bookId")::int as "pageCount", l."title", l."text"
       from "book_page" p
       join "book_line" l on l."lineId" = p."lineId" and l."lang" = $1 and l."isCurrent"
      where p."aliasOf" is null and p."pageTextId" is not null
      order by p."bookId"::int, p."pageNumber"`,
    [LANG],
  );
```

`Books.lua` stays numeric. Minted and English-less pages reach the addon through the language packs (Task 11).

`lookup.mjs`'s locale pages query: change `join "book_line" e on e."lineId" = l."lineId" and e."lang" = $2 and e."isCurrent"` to `join "book_page" e on e."lineId" = l."lineId" and e."aliasOf" is null`. Select `e."pageTextId" as "pageId", e."bookId", e."pageNumber", e."ownerKind", coalesce(e."ownerIds", '{}') as "ownerIds"`, and keep `where e."pageTextId" is not null` for now (Task 11 lifts it). The query no longer needs `$2`, so remove `LANG` from its parameters.

- [ ] **Step 5: `import_questit.py` takes structure from `book_page`**

```python
            cur.execute(
                """insert into "book_line"
                     ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
                      "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
                      "text", "generatable", "skipReason", "note")
                   select p."lineId", %s,
                          coalesce((select max(m."version") from "book_line" m
                                     where m."lineId" = p."lineId" and m."lang" = %s), 0) + 1,
                          %s, 'community', p."pageTextId", p."bookId"::int, p."pageNumber",
                          (select count(*) from "book_page" c where c."bookId" = p."bookId"),
                          e."title", p."ownerKind", p."ownerIds", coalesce(p."material", 0), %s, true, null, %s
                     from "book_page" p
                     join "book_line" e on e."lineId" = p."lineId" and e."lang" = 'enUS' and e."isCurrent"
                    where p."lineId" = %s """,
                (LANG, LANG, action == "promote", italian, note, line_id),
            )
```

QuestIT matches Italian to English pages by hash, so the join on English stays. Only structure moves.

- [ ] **Step 6: Run every affected suite**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/readables; and make readables-test; and cd pipelines/quests; and uv run pytest -q tests -k questit; cd -`
Expected: PASS. Also run `make readables-export` against `spoken_ci_pin`: `git diff --stat addons/Spoken_Books/Data/Books.lua` must show no change.

- [ ] **Step 7: Commit**

```fish
git add apps/web/src/lib/readables/text.ts apps/web/src/lib/readables/text.test.ts pipelines/readables/tools/export.mjs pipelines/readables/tools/lib/lookup.mjs pipelines/quests/tools/import_questit.py
git commit -m "Books: export, lookup and text saves take structure from book_page"
```

---

## PR 3: matching, triage, accept, corrections

### Task 6: The matcher

**Files:**
- Create: `apps/web/src/lib/contributions/book-match.ts`
- Test: `apps/web/src/lib/contributions/book-match.test.ts`

**Interfaces:**
- Consumes: `normaliseText` from `@readables-tools/lib/text.mjs` (already imported by `submission.ts`).
- Produces:

```ts
export type BookCorpusPage = {
  lineId: string;
  bookId: string;
  pageNumber: number;
  ownerKind: "object" | "item" | null;
  ownerIds: number[];
  /** lang -> current text */
  texts: Map<string, string>;
  /** lang -> the title a client in that language shows: the owner's entity_name, else the page's own */
  titles: Map<string, string>;
};
export type BookCorpus = { pages: BookCorpusPage[] };

export type BookMatchInput = {
  locale: string;
  text: string | null;
  meta: Record<string, string>;
  matchLineId: string | null;
  matchBookId: string | null;
  matchPageNumber: number | null;
  matchNewBook: boolean;
};

export type BookMatchResult =
  | { kind: "known"; lineId: string; via: MatchVia }
  | { kind: "correction"; lineId: string; current: string; via: MatchVia }
  | { kind: "translation"; lineId: string; via: MatchVia }
  | { kind: "new-page"; bookId: string; pageNumber: number; via: MatchVia }
  | { kind: "new-book"; title: string; pageNumber: number; via: MatchVia }
  | { kind: "ambiguous"; candidates: string[] };
export type MatchVia = "moderator" | "owner" | "text" | "title" | "none";

export function matchBook(row: BookMatchInput, corpus: BookCorpus): BookMatchResult;
export async function loadBookCorpus(client?: { query: Queryable }): Promise<BookCorpus>;
```

- [ ] **Step 1: Write the failing tests** (pure, no database)

```ts
import { describe, expect, it } from "vitest";

import { matchBook, type BookCorpus, type BookMatchInput } from "./book-match";

function page(lineId: string, bookId: string, pageNumber: number, texts: Record<string, string>, titles: Record<string, string>, owner?: [ "object" | "item", number ]) {
  return {
    lineId, bookId, pageNumber,
    ownerKind: owner?.[0] ?? null, ownerIds: owner ? [owner[1]] : [],
    texts: new Map(Object.entries(texts)), titles: new Map(Object.entries(titles)),
  };
}

const corpus: BookCorpus = {
  pages: [
    page("b:38", "38", 1, { enUS: "Stoutmantle --", esES: "Stoutmantle -- Qué descaro", esMX: "Mantorrecio: Hay que tener osadía" }, { enUS: "Wiley's Note", esES: "Nota de Wiley", esMX: "Nota de Wiley" }, ["item", 1]),
    page("b:39", "38", 2, { enUS: "They have a vast network", esMX: "Han mandado construir" }, { enUS: "Wiley's Note", esES: "Nota de Wiley", esMX: "Nota de Wiley" }, ["item", 1]),
    page("b:500", "500", 1, { enUS: "Dust one." }, { enUS: "A Dusty Tome" }),
    page("b:600", "600", 1, { enUS: "Dust two." }, { enUS: "A Dusty Tome" }),
  ],
};

function row(over: Partial<BookMatchInput>): BookMatchInput {
  return { locale: "esES", text: null, meta: {}, matchLineId: null, matchBookId: null, matchPageNumber: null, matchNewBook: false, ...over };
}

describe("matchBook", () => {
  it("finds a page by another language's exact words, as a correction where this language differs", () => {
    expect(matchBook(row({ text: "Mantorrecio: Hay que tener osadía", meta: { book: "Nota de Wiley", number: "1" } }), corpus))
      .toEqual({ kind: "correction", lineId: "b:38", current: "Stoutmantle -- Qué descaro", via: "text" });
  });

  it("calls a page this language has with the same words known", () => {
    expect(matchBook(row({ text: "Stoutmantle -- Qué descaro" }), corpus)).toMatchObject({ kind: "known", lineId: "b:38" });
  });

  it("calls a page this language lacks a translation", () => {
    expect(matchBook(row({ text: "Han mandado construir" }), corpus)).toMatchObject({ kind: "translation", lineId: "b:39", via: "text" });
  });

  it("places by title and number when the words are new", () => {
    expect(matchBook(row({ text: "Otras palabras", meta: { book: "Nota de Wiley", number: "2" } }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "title" });
    expect(matchBook(row({ text: "Otras palabras", meta: { book: "Nota de Wiley", number: "3" } }), corpus))
      .toEqual({ kind: "new-page", bookId: "38", pageNumber: 3, via: "title" });
  });

  it("never guesses between two books of one title", () => {
    expect(matchBook(row({ locale: "enUS", text: "Dust three.", meta: { book: "A Dusty Tome", number: "1" } }), corpus))
      .toEqual({ kind: "ambiguous", candidates: ["500", "600"] });
  });

  it("starts a new book when nothing matches", () => {
    expect(matchBook(row({ text: "Trotamundos de los elfos:", meta: { book: "Instrucciones del consejero Nazgrel", number: "1" } }), corpus))
      .toEqual({ kind: "new-book", title: "Instrucciones del consejero Nazgrel", pageNumber: 1, via: "none" });
  });

  it("matches by the item that was read before anything else", () => {
    expect(matchBook(row({ text: "Otras palabras", meta: { item: "1", number: "2" } }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "owner" });
  });

  it("takes a moderator's answer over every guess", () => {
    expect(matchBook(row({ text: "Mantorrecio: Hay que tener osadía", matchLineId: "b:39" }), corpus))
      .toMatchObject({ kind: "translation", lineId: "b:39", via: "moderator" });
    expect(matchBook(row({ text: "x", matchBookId: "500", matchPageNumber: 4 }), corpus))
      .toEqual({ kind: "new-page", bookId: "500", pageNumber: 4, via: "moderator" });
    expect(matchBook(row({ text: "x", meta: { book: "Nota de Wiley", number: "1" }, matchNewBook: true }), corpus))
      .toEqual({ kind: "new-book", title: "Nota de Wiley", pageNumber: 1, via: "moderator" });
  });

  it("calls two pages with the same words in any language ambiguous", () => {
    const twin = { pages: [...corpus.pages, page("b:700", "700", 1, { enUS: "Dust one." }, { enUS: "Another" })] };
    expect(matchBook(row({ locale: "deDE", text: "Dust one." }), twin)).toEqual({ kind: "ambiguous", candidates: ["b:500", "b:700"] });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter web exec vitest run src/lib/contributions/book-match.test.ts`
Expected: FAIL, cannot resolve `./book-match`.

- [ ] **Step 3: Implement**

```ts
/**
 * Which page a books contribution is, and what accepting it would do.
 *
 * The envelope names no page: its key is the checksum of the text on screen. So the page is
 * found the way a person would find it, most certain first -- the item or object the client
 * read it from, the same words in any language, then the title and page number the client
 * showed -- and where two candidates remain, nothing is guessed. A moderator's answer, stored on
 * the contribution, overrides all of it.
 *
 * Computed against the corpus as it stands, never stored: once a new book's first page is
 * accepted, its other pages find it by title.
 */
import { normaliseText } from "@readables-tools/lib/text.mjs";

import { db } from "@/lib/db";

// … the exported types from the Interfaces block above …

const normal = (text: string) => (normaliseText(text) as string).trim();

function pageNumberOf(meta: Record<string, string>): number {
  const number = Number(meta.number);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function onPage(page: BookCorpusPage, row: BookMatchInput, via: MatchVia): BookMatchResult {
  const current = page.texts.get(row.locale);
  if (current === undefined) return { kind: "translation", lineId: page.lineId, via };
  if (row.text !== null && normal(current) === normal(row.text)) return { kind: "known", lineId: page.lineId, via };
  return { kind: "correction", lineId: page.lineId, current, via };
}

function inBook(corpus: BookCorpus, bookId: string, pageNumber: number, row: BookMatchInput, via: MatchVia): BookMatchResult {
  const page = corpus.pages.find((p) => p.bookId === bookId && p.pageNumber === pageNumber);
  return page ? onPage(page, row, via) : { kind: "new-page", bookId, pageNumber, via };
}

export function matchBook(row: BookMatchInput, corpus: BookCorpus): BookMatchResult {
  const pageNumber = row.matchPageNumber ?? pageNumberOf(row.meta);
  const title = row.meta.book?.trim() ?? "";

  if (row.matchLineId) {
    const page = corpus.pages.find((p) => p.lineId === row.matchLineId);
    if (page) return onPage(page, row, "moderator");
  }
  if (row.matchBookId) return inBook(corpus, row.matchBookId, pageNumber, row, "moderator");
  if (row.matchNewBook) return { kind: "new-book", title, pageNumber, via: "moderator" };

  // 1. What the client read it from.
  for (const [kind, field] of [["item", "item"], ["object", "object"]] as const) {
    const id = Number(row.meta[field]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const books = new Set(corpus.pages.filter((p) => p.ownerKind === kind && p.ownerIds.includes(id)).map((p) => p.bookId));
    if (books.size === 1) return inBook(corpus, [...books][0], pageNumber, row, "owner");
  }

  // 2. The same words, in any language.
  if (row.text) {
    const said = normal(row.text);
    const same = corpus.pages.filter((p) => [...p.texts.values()].some((t) => normal(t) === said));
    if (same.length === 1) return onPage(same[0], row, "text");
    if (same.length > 1) {
      // The same words in this language on one page is that page, whatever else repeats them.
      const own = same.filter((p) => p.texts.has(row.locale) && normal(p.texts.get(row.locale)!) === said);
      if (own.length === 1) return onPage(own[0], row, "text");
      return { kind: "ambiguous", candidates: same.map((p) => p.lineId).sort() };
    }
  }

  // 3. The title and page number, in this language.
  if (title) {
    const books = [...new Set(corpus.pages.filter((p) => p.titles.get(row.locale) === title).map((p) => p.bookId))].sort();
    if (books.length === 1) return inBook(corpus, books[0], pageNumber, row, "title");
    if (books.length > 1) return { kind: "ambiguous", candidates: books };
  }

  // 4. Nothing has it.
  return { kind: "new-book", title, pageNumber, via: "none" };
}

type Queryable = <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;

/** Every live page with each language's current words and the title its clients show. */
export async function loadBookCorpus(client?: { query: Queryable }): Promise<BookCorpus> {
  const q = client ?? db();
  const { rows } = await q.query<{
    lineId: string; bookId: string; pageNumber: number; ownerKind: "object" | "item" | null;
    ownerIds: number[] | null; lang: string | null; text: string | null; title: string | null; ownerName: string | null;
  }>(
    `select p."lineId", p."bookId", p."pageNumber", p."ownerKind", p."ownerIds",
            l."lang", l."text", l."title",
            (select n."name" from "entity_name" n
              where n."kind" = case p."ownerKind" when 'object' then 'gameobject' else 'item' end
                and n."entityId" = p."ownerIds"[1]::text and n."lang" = l."lang" and n."isCurrent") as "ownerName"
       from "book_page" p
       left join "book_line" l on l."lineId" = p."lineId" and l."isCurrent"
      where p."aliasOf" is null`,
  );
  const pages = new Map<string, BookCorpusPage>();
  for (const row of rows) {
    let page = pages.get(row.lineId);
    if (!page) {
      page = { lineId: row.lineId, bookId: row.bookId, pageNumber: row.pageNumber, ownerKind: row.ownerKind,
        ownerIds: row.ownerIds ?? [], texts: new Map(), titles: new Map() };
      pages.set(row.lineId, page);
    }
    if (row.lang && row.text !== null) page.texts.set(row.lang, row.text);
    const title = row.ownerName ?? row.title;
    if (row.lang && title) page.titles.set(row.lang, title);
  }
  return { pages: [...pages.values()] };
}
```

Fill in the `// … the exported types …` comment with the exact types from the Interfaces block. Step 2's same-words rule handles the `own` case first, because a language may share a page's words with another language (esES = esMX on 43 pages).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter web exec vitest run src/lib/contributions/book-match.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```fish
git add apps/web/src/lib/contributions/book-match.ts apps/web/src/lib/contributions/book-match.test.ts
git commit -m "Contributions: match a books row to its page by owner, words or title"
```

### Task 7: Triage shows the match, and a moderator can change it

**Files:**
- Modify: `apps/web/src/lib/contributions/store.ts` (`CONTRIBUTION_COLUMNS`, `Contribution`, replace `setContributionPage` with `setContributionMatch`)
- Modify: `apps/web/src/lib/contributions/triage.ts` (`BookMatch`, `BookSummary`, `bookFor`)
- Modify: `apps/web/src/app/[lang]/contributions/[source]/page.tsx` (`bookMatchesFor`, `existingTextFor`, the `books` facets, `book:` on each row)
- Modify: `apps/web/src/app/api/contributions/page/route.ts`
- Modify: `apps/web/src/components/ContributionTable.tsx:106-110,183,1150-1230` (`BookSummary` type use, `BookMatchCell`)
- Test: `apps/web/src/app/api/contributions/page/route.test.ts` (rewrite), `apps/web/src/lib/contributions/triage.test.ts` (if present, else create)

**Interfaces:**
- Consumes: `matchBook`, `loadBookCorpus`, `BookMatchResult` from Task 6.
- Produces:
  - `setContributionMatch(id, match: { lineId: string } | { bookId: string; pageNumber: number } | { newBook: true } | null, by) -> Contribution | null`
  - `BookSummary = { title: string | null; number: number | null; match: BookMatchResult; label: string }`
  - `bookFor(row, match: BookMatchResult, describe: (lineId: string) => string) -> BookSummary | null`. Returns null only for non-books rows. English rows are included now.
  - POST `/api/contributions/page` body `{ id, lineId } | { id, bookId, pageNumber } | { id, newBook: true } | { id, clear: true }`, returning `{ ok: true, match: BookMatchResult }`.

- [ ] **Step 1: Write the failing route test**

Rewrite `route.test.ts`, keeping its mocks, its `ip` bucket and its `contribution()` helper. Seed `book_page` and `book_line` for a two-page book with ids `b:${base}` and `b:${base + 1}` and `bookId = String(base)`. Then:

```ts
describe("POST /api/contributions/page", () => {
  it("records a page by its lineId, in any language", async () => {
    const id = await contribution();
    editable.add("ptBR");
    const response = await POST(post({ id, lineId: `b:${base + 1}` }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ match: { kind: "translation", lineId: `b:${base + 1}`, via: "moderator" } });
    expect(await matchOf(id)).toEqual({ matchLineId: `b:${base + 1}`, matchBookId: null, matchPageNumber: null, matchNewBook: false });
  });

  it("records a place in a book the book does not have yet, as a new page", async () => {
    const id = await contribution();
    editable.add("ptBR");
    const response = await POST(post({ id, bookId: String(base), pageNumber: 9 }));
    expect(await response.json()).toMatchObject({ match: { kind: "new-page", bookId: String(base), pageNumber: 9 } });
  });

  it("records a new book, and clears every answer", async () => {
    const id = await contribution();
    editable.add("ptBR");
    expect(await (await POST(post({ id, newBook: true }))).json()).toMatchObject({ match: { kind: "new-book" } });
    expect((await POST(post({ id, clear: true }))).status).toBe(200);
    expect(await matchOf(id)).toEqual({ matchLineId: null, matchBookId: null, matchPageNumber: null, matchNewBook: false });
  });

  it("refuses a lineId that is no page", async () => {
    const id = await contribution();
    editable.add("ptBR");
    expect((await POST(post({ id, lineId: "b:999999999" }))).status).toBe(400);
  });

  it("refuses a viewer who cannot edit the row's language", async () => {
    const id = await contribution();
    expect((await POST(post({ id, newBook: true }))).status).toBe(403);
  });
});
```

with

```ts
async function matchOf(id: number) {
  const { rows } = await db().query(
    `select "matchLineId", "matchBookId", "matchPageNumber", "matchNewBook" from "contribution" where "id" = $1`, [id]);
  return rows[0];
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/app/api/contributions/page/route.test.ts`
Expected: FAIL. The current route answers 400 "a book and a page number are required" to `{ lineId }`.

- [ ] **Step 3: `store.ts`**

Add `"matchLineId", "matchBookId", "matchPageNumber", "matchNewBook"` to `CONTRIBUTION_COLUMNS` and to `Contribution`:

```ts
  /** A moderator's answer to "which page is this?" (migration 0074): a page, a place in a book, or a new book. */
  matchLineId: string | null;
  matchBookId: string | null;
  matchPageNumber: number | null;
  matchNewBook: boolean;
```

Keep `pageId` in the columns list until Task 15 drops it. Replace `setContributionPage` with:

```ts
export type BookAnswer = { lineId: string } | { bookId: string; pageNumber: number } | { newBook: true } | null;

/**
 * Record which page a books contribution is, or clear the answer with null. A no-op, returning
 * null, for a row that is not books or whose page accept has already written -- that is one-way
 * (accept.ts). The page or book is the caller's to check exists. Returns the updated row.
 */
export async function setContributionMatch(id: number, answer: BookAnswer, by: string | null): Promise<Contribution | null> {
  const lineId = answer && "lineId" in answer ? answer.lineId : null;
  const bookId = answer && "bookId" in answer ? answer.bookId : null;
  const pageNumber = answer && "pageNumber" in answer ? answer.pageNumber : null;
  const newBook = answer !== null && "newBook" in answer;
  const { rows } = await db().query<Contribution>(
    `update "contribution"
        set "matchLineId" = $2, "matchBookId" = $3, "matchPageNumber" = $4, "matchNewBook" = $5,
            "updatedAt" = now()
      where "id" = $1 and "source" = 'books'
        and not exists (select 1 from "book_line" b
                         where b."note" in ('contribution #' || "contribution"."id",
                                            'correction from the game, contribution #' || "contribution"."id"))
      returning ${COLUMNS}`,
    [id, lineId, bookId, pageNumber, newBook],
  );
  const row = rows[0];
  if (!row) return null;
  await recordActivity({
    kind: "contribution.edited",
    lang: isLang(row.locale) ? row.locale : null,
    source: row.source,
    subject: String(id),
    actorId: by,
    detail: { field: "match", value: answer },
  });
  return row;
}
```

- [ ] **Step 4: The route**

```ts
/**
 * A moderator's answer to "which page is this?" for a books contribution: a page in any
 * language, a place in a book, or a new book. Stored on the contribution
 * (store.ts's setContributionMatch); the automatic match (book-match.ts) stands where there is
 * none. Refused once the row's page is written -- that is one-way (accept.ts).
 *
 * Gated as ../npc-identity is: whoever may edit the row's language.
 */
import { requireCapability } from "@/lib/generation/authz";
import { loadBookCorpus, matchBook } from "@/lib/contributions/book-match";
import { contributionLocale, setContributionMatch, type BookAnswer } from "@/lib/contributions/store";
import { BASE_LANG, isLang } from "@/lib/lang";
import { INT32_MAX } from "@/lib/npc/npc";

export const dynamic = "force-dynamic";

function answerOf(body: Record<string, unknown>): BookAnswer | undefined {
  if (body.clear === true) return null;
  if (body.newBook === true) return { newBook: true };
  if (typeof body.lineId === "string" && /^b:(\d+|n[0-9a-f-]{36})$/.test(body.lineId)) return { lineId: body.lineId };
  if (typeof body.bookId === "string" && typeof body.pageNumber === "number"
      && Number.isInteger(body.pageNumber) && body.pageNumber > 0 && body.pageNumber <= 1000) {
    return { bookId: body.bookId, pageNumber: body.pageNumber };
  }
  return undefined;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0 || id > INT32_MAX) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }
  const answer = answerOf(body);
  if (answer === undefined) {
    return Response.json({ error: "a page, a book and page number, a new book, or clear" }, { status: 400 });
  }

  const locale = await contributionLocale(id);
  const { session, denied } = await requireCapability("edit", isLang(locale) ? locale : BASE_LANG);
  if (denied) return denied;

  const corpus = await loadBookCorpus();
  if (answer && "lineId" in answer && !corpus.pages.some((p) => p.lineId === answer.lineId)) {
    return Response.json({ error: `${answer.lineId} is not a page` }, { status: 400 });
  }
  if (answer && "bookId" in answer && !corpus.pages.some((p) => p.bookId === answer.bookId)) {
    return Response.json({ error: `there is no book ${answer.bookId}` }, { status: 400 });
  }

  const recorded = await setContributionMatch(id, answer, session.user.id);
  if (!recorded) {
    return Response.json({ error: "no such books contribution, or its page is already written" }, { status: 409 });
  }
  return Response.json({ ok: true, match: matchBook({ ...recorded, text: recorded.text }, corpus) });
}
```

- [ ] **Step 5: `triage.ts`**

Replace `BookMatch`, `BookSummary` and `bookFor`:

```ts
import type { BookMatchResult } from "./book-match";

/**
 * The Match column's content for one books contribution: what the client showed, what the
 * matcher (or a moderator) decided it is, and that decision in words.
 */
export type BookSummary = { title: string | null; number: number | null; match: BookMatchResult; label: string };

export function bookFor(
  row: { source: string; meta: Record<string, string> },
  match: BookMatchResult,
  describe: (lineId: string) => string,
): BookSummary | null {
  if (row.source !== "books") return null;
  const number = Number(row.meta.number);
  const title = row.meta.book?.trim() || null;
  return {
    title,
    number: Number.isInteger(number) && number > 0 ? number : null,
    match,
    label: labelOf(match, describe),
  };
}

export function labelOf(match: BookMatchResult, describe: (lineId: string) => string): string {
  switch (match.kind) {
    case "known": return `Already there · ${describe(match.lineId)}`;
    case "correction": return `Correction · ${describe(match.lineId)}`;
    case "translation": return `Translation · ${describe(match.lineId)}`;
    case "new-page": return `New page · ${describe(`book:${match.bookId}`)} p.${match.pageNumber}`;
    case "new-book": return `New book · ${match.title || "untitled"} p.${match.pageNumber}`;
    case "ambiguous": return `Ambiguous · ${match.candidates.length} candidates`;
  }
}
```

Add a unit test in `triage.test.ts` for `labelOf`'s six kinds, using `describe = (id) => id`. For example, `expect(labelOf({ kind: "new-book", title: "", pageNumber: 2, via: "none" }, (id) => id)).toBe("New book · untitled p.2")`.

- [ ] **Step 6: `page.tsx`**

Replace `bookMatchesFor` with:

```ts
/** What each books row is (book-match.ts), and a way to name a page or book in the row's language. */
async function bookMatchesFor(contributions: Contribution[]) {
  const books = contributions.filter((row) => row.source === "books");
  if (books.length === 0) return { matches: new Map<number, BookMatchResult>(), describe: () => "" };
  const corpus = await loadBookCorpus();
  const matches = new Map(books.map((row) => [row.id, matchBook(row, corpus)]));
  const byLine = new Map(corpus.pages.map((p) => [p.lineId, p]));
  const firstOf = new Map<string, BookCorpusPage>();
  for (const p of corpus.pages) if (!firstOf.has(p.bookId) || p.pageNumber < firstOf.get(p.bookId)!.pageNumber) firstOf.set(p.bookId, p);
  const titleIn = (p: BookCorpusPage | undefined, lang: string) => p?.titles.get(lang) ?? p?.titles.get(BASE_LANG) ?? [...(p?.titles.values() ?? [])][0] ?? "untitled";
  const describeIn = (lang: string) => (id: string) => {
    if (id.startsWith("book:")) return titleIn(firstOf.get(id.slice(5)), lang);
    const page = byLine.get(id);
    return page ? `${titleIn(page, lang)} p.${page.pageNumber}` : id;
  };
  return { matches, describe: describeIn };
}
```

Change the call site's destructuring to `const [existing, linedIds, { matches: bookMatches, describe }] = …`, and the row's `book:` to

```ts
    book: row.source === "books" ? bookFor(row, bookMatches.get(row.id)!, describe(row.locale)) : null,
```

The book picker's options now come from every language, not English alone:

```ts
  const books = shown.some((row) => row.source === "books")
    ? (await bookFacets(lang)).map(({ bookId, title, pages }) => ({ bookId, title, pages }))
    : [];
```

`bookFacets(lang)` already lists every page (Task 4), with titles in the viewer's language and English or any language standing in.

In `existingTextFor`, the books branch uses the match instead of `corpusLookup`. Show the current text of the matched page in the row's language, or English when it has none:

```ts
      if (row.source === "books") {
        const match = bookMatches.get(row.id);
        const lineId = match && "lineId" in match ? match.lineId : null;
        const page = lineId ? (await catalogue(isLang(row.locale) ? row.locale : BASE_LANG)).find((p) => p.id === lineId) : undefined;
        if (page && page.text) found[row.id] = page.text;
        return;
      }
```

To have `bookMatches` available there, move the `bookMatchesFor(shown)` call ahead of `existingTextFor` and pass it in. Change the signature to `existingTextFor(contributions, bookMatches)`.

- [ ] **Step 7: `ContributionTable.tsx`'s Match cell**

Rename `BookMatchCell` to `MatchCell` and change its content. It shows `book.label`; for `known`/`correction`/`translation` it links the page at `/readables/r/${pageKeyOf(lineId)}` (import `pageKeyOf` is server-only, so compute `href` in `page.tsx` and pass it as `book.href`). Its controls are:
- a `<select>` of books from the `books` datalist plus a `"new"` option labelled "New book",
- the page number input (start value `book.number ?? 1`),
- **Match**, which POSTs `{ id, bookId, pageNumber }`, or `{ id, newBook: true }` when "new" is selected,
- **Clear**, shown only when `book.match.via === "moderator"`, which POSTs `{ id, clear: true }`.

Change the placeholder from "English book" to "Book". Add `href: string | null` to `BookSummary` and fill it in `bookFor`'s caller: for a `lineId` match, `localeHref(lang, \`/readables/r/${pageKeyOf(lineId)}\`)`, otherwise null.

Replace the accept-button guard that disabled books rows with no `pageId` (search `match === null` / `needs-page` in the component) with `book.match.kind === "ambiguous" || book.match.kind === "known"`, and a tooltip: "Pick the page first" or "Already in the corpus".

- [ ] **Step 8: Run the suites**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/app/api/contributions src/lib/contributions src/components; and pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 9: Check it in the browser on `spoken_dev`**

Run `make dev` with `DATABASE_URL=postgres:///spoken_dev` and open `/contributions/readables`. Expected: contribution 30090 reads "Correction · Registro de Reclutamiento de la Horda p.1" (or "Translation", if esES has no row for page 340), and an unknown title reads "New book · …".

- [ ] **Step 10: Commit**

```fish
git add -A apps/web/src/lib/contributions apps/web/src/app/api/contributions/page apps/web/src/app/[lang]/contributions apps/web/src/components/ContributionTable.tsx
git commit -m "Contributions: books rows show what they are, and a moderator can say otherwise"
```

### Task 8: Accepting writes the page, in any language, minting where the game named none

**Files:**
- Create: `apps/web/migrations/0075_book_line_structure_nullable.sql`
- Modify: `apps/web/src/lib/contributions/accept.ts` (replace `acceptBookTranslation` with `acceptBookContribution`; `resolveContribution`'s books branch; `booksInExplorer`; `contributedPageExists`)
- Test: `apps/web/src/lib/contributions/accept.test.ts` (books cases)

**Interfaces:**
- Consumes: `loadBookCorpus`, `matchBook` (Task 6), `mintPageId`, `mintBookId` (Task 3), `saveBookText` (Task 5b).
- Produces: `acceptBookContribution(client, contribution, userId) -> Promise<ResolveRefusal | null>`.

- [ ] **Step 1: The migration**

```sql
-- book_line's copy of a page's structure is no longer read (book_page holds it), so a page with
-- no pageTextID, or in a book with no integer id, may leave it empty. Relaxing only: every row
-- the previous release reads still has these filled in.
alter table "book_line" alter column "pageId" drop not null;
alter table "book_line" alter column "bookId" drop not null;
alter table "book_line" alter column "pageNumber" drop not null;
alter table "book_line" alter column "pageCount" drop not null;
alter table "book_line" alter column "ownerKind" drop not null;
alter table "book_line" alter column "ownerIds" drop not null;
alter table "book_line" drop constraint if exists "book_line_ownerKind_check";
alter table "book_line" add constraint "book_line_ownerKind_check" check ("ownerKind" is null or "ownerKind" in ('object', 'item'));
```

Check the trigger `entity_name_from_book_line` (`grep -rn "entity_name_from_book_line" apps/web/migrations`) and make it skip a row whose `ownerKind` is null. Add that change to this same migration as a `create or replace function`, copied from the latest definition with `if new."ownerKind" is null then return new; end if;` as its first statement.

Then remove the placeholder structure values from Task 4's `catalogue.test.ts` fixture (`"pageId", "bookId", "pageNumber", "pageCount", "ownerKind", "ownerIds"` and their values).

- [ ] **Step 2: Write the failing tests** in `accept.test.ts`

Follow the file's existing pattern: insert a contribution, call `resolveContribution(id, "accepted", USER)`, and read back. Seed a two-page book `b:${base}`/`b:${base+1}` with English and esMX text as Task 7 did.

```ts
describe("accepting a books contribution", () => {
  it("writes a translation of a page found by another language's words", async () => {
    const id = await booksRow({ locale: "esES", text: "Palabras esMX uno.", meta: { book: "Libro", number: "1" } });
    expect(await resolveContribution(id, "accepted", USER)).toMatchObject({ ok: true });
    expect(await textOf(`b:${base}`, "esES")).toEqual({ text: "Palabras esMX uno.", origin: "contributed", title: "Libro" });
  });

  it("writes a correction as a new version", async () => {
    await textRow(`b:${base}`, "esES", "Viejo texto.");
    const id = await booksRow({ locale: "esES", text: "Palabras esMX uno.", meta: { book: "Libro", number: "1" } });
    expect(await resolveContribution(id, "accepted", USER)).toMatchObject({ ok: true });
    expect(await versionsOf(`b:${base}`, "esES")).toEqual([
      { version: 2, isCurrent: true, text: "Palabras esMX uno." },
      { version: 1, isCurrent: false, text: "Viejo texto." },
    ]);
  });

  it("mints a new book, and its next page joins it", async () => {
    const title = `Instrucciones ${base}`;
    const first = await booksRow({ locale: "esES", text: `Uno ${base}.`, meta: { book: title, number: "1" } });
    const third = await booksRow({ locale: "esES", text: `Tres ${base}.`, meta: { book: title, number: "3" } });
    expect(await resolveContribution(first, "accepted", USER)).toMatchObject({ ok: true });
    expect(await resolveContribution(third, "accepted", USER)).toMatchObject({ ok: true });
    const pages = await pagesTitled(title, "esES");
    expect(pages).toHaveLength(2);
    expect(new Set(pages.map((p) => p.bookId)).size).toBe(1);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 3]);
    expect(pages[0].lineId).toMatch(/^b:n[0-9a-f-]{36}$/);
    expect(pages[0].bookId).toMatch(/^n[0-9a-f-]{36}$/);
  });

  it("mints one book for two pages of one title accepted at once", async () => {
    const title = `Simultáneo ${base}`;
    const a = await booksRow({ locale: "esES", text: `A ${base}.`, meta: { book: title, number: "1" } });
    const b = await booksRow({ locale: "esES", text: `B ${base}.`, meta: { book: title, number: "2" } });
    await Promise.all([resolveContribution(a, "accepted", USER), resolveContribution(b, "accepted", USER)]);
    expect(new Set((await pagesTitled(title, "esES")).map((p) => p.bookId)).size).toBe(1);
  });

  it("accepts an English page the corpus lacks", async () => {
    const id = await booksRow({ locale: "enUS", text: `Forever only ${base}.`, meta: { book: `New in Forever ${base}`, number: "1" } });
    expect(await resolveContribution(id, "accepted", USER)).toMatchObject({ ok: true });
    expect(await pagesTitled(`New in Forever ${base}`, "enUS")).toHaveLength(1);
  });

  it("refuses an ambiguous row until a moderator answers", async () => {
    const id = await booksRow({ locale: "enUS", text: "Unseen.", meta: { book: DUSTY, number: "1" } });
    expect(await resolveContribution(id, "accepted", USER)).toMatchObject({ ok: false, reason: "needs-page" });
  });
});
```

Seed `DUSTY` as a title two books of this run share. Helpers:

```ts
async function booksRow(over: { locale: string; text: string; meta: Record<string, string> }): Promise<number> {
  const { rows } = await db().query<{ id: number }>(
    `insert into "contribution" ("source", "key", "locale", "build", "meta", "raw", "dedup", "text", "ip")
     values ('books', '1', $1, '', $2, 'raw', $3, $4, $5) returning "id"`,
    [over.locale, over.meta, `${ip}-${Math.random()}`, over.text, ip],
  );
  return rows[0].id;
}
async function textOf(lineId: string, lang: string) {
  const { rows } = await db().query(`select "text", "origin", "title" from "book_line" where "lineId" = $1 and "lang" = $2 and "isCurrent"`, [lineId, lang]);
  return rows[0];
}
async function versionsOf(lineId: string, lang: string) {
  const { rows } = await db().query(`select "version", "isCurrent", "text" from "book_line" where "lineId" = $1 and "lang" = $2 order by "version" desc`, [lineId, lang]);
  return rows;
}
async function pagesTitled(title: string, lang: string) {
  const { rows } = await db().query<{ lineId: string; bookId: string; pageNumber: number }>(
    `select p."lineId", p."bookId", p."pageNumber" from "book_page" p
       join "book_line" l on l."lineId" = p."lineId" and l."lang" = $2 and l."isCurrent"
      where l."title" = $1 order by p."pageNumber"`, [title, lang]);
  return rows;
}
```

Clean up in `afterAll`: delete `book_line` and `book_page` rows whose `note` is `contribution #<id>` for this run's contributions, plus the seeded rows.

- [ ] **Step 3: Run them to see them fail**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; deploy/web/bin/migrate.sh $PWD/apps/web; and pnpm --filter web exec vitest run src/lib/contributions/accept.test.ts -t "books contribution"`
Expected: FAIL. The translation case is refused with `needs-page` ("Match it to an English page first").

- [ ] **Step 4: Implement `acceptBookContribution`**

Replace `acceptBookTranslation` and its docstring:

```ts
/**
 * A books contribution, in any language: what the matcher says it is, written.
 *
 * Matched again here, inside the transaction and under a lock on its language and title, so
 * two pages of one new book accepted at once find each other rather than minting two books.
 * A page the game names keeps its id; one only a player's client has shown gets a minted one
 * (naming.mjs). A correction is a new version of that language's text, as an editor's save is;
 * the rest is a first version, 'contributed'. Known and ambiguous rows are refused: there is
 * nothing to write, or nobody has said where.
 */
async function acceptBookContribution(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
): Promise<ResolveRefusal | null> {
  const text = contribution.text?.trim();
  if (!text) return { ok: false, reason: "malformed", message: "contribution has no text to voice" };
  const lang = contribution.locale as Lang;
  const title = contribution.meta.book?.trim() || null;
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`books|${lang}|${title ?? ""}`]);

  const match = matchBook(contribution, await loadBookCorpus(client));
  const note = noteFor(contribution.id);
  const { generatable, skipReason } = isGeneratable(speakPlayerTokens(text, lang));

  switch (match.kind) {
    case "ambiguous":
      return { ok: false, reason: "needs-page", message: "Several pages could be this one -- pick it first." };
    case "known":
      return { ok: false, reason: "malformed", message: "The corpus already has these words for this page." };
    case "correction": {
      await client.query(
        `update "book_line" set "isCurrent" = false where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
        [match.lineId, lang],
      );
      await insertText(client, { lineId: match.lineId, lang, title, text, generatable, skipReason, userId, note, origin: "edited" });
      return null;
    }
    case "translation":
      await insertText(client, { lineId: match.lineId, lang, title, text, generatable, skipReason, userId, note, origin: "contributed" });
      await nameOwnersIfUnnamed(client, match.lineId, lang, title, userId, note);
      return null;

    case "new-page":
    case "new-book": {
      const bookId = match.kind === "new-page" ? match.bookId : mintBookId();
      const lineId = mintPageId();
      await client.query(
        `insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, $3)`,
        [lineId, bookId, match.pageNumber],
      );
      await insertText(client, { lineId, lang, title, text, generatable, skipReason, userId, note, origin: "contributed" });
      return null;
    }
  }
}

/** One language's text of a page, versioned after whatever that language already has. */
async function insertText(
  client: PoolClient,
  row: { lineId: string; lang: Lang; title: string | null; text: string; generatable: boolean; skipReason: string | null;
         userId: string; note: string; origin: "contributed" | "edited" },
): Promise<void> {
  await client.query(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId", "pageNumber", "pageCount",
        "title", "ownerKind", "ownerIds", "material", "text", "generatable", "skipReason", "editedBy", "note")
     select p."lineId", $2,
            coalesce((select max(m."version") from "book_line" m where m."lineId" = p."lineId" and m."lang" = $2), 0) + 1,
            true, $9, p."pageTextId", case when p."bookId" ~ '^\\d+$' then p."bookId"::int end, p."pageNumber",
            (select count(*) from "book_page" c where c."bookId" = p."bookId" and c."aliasOf" is null),
            coalesce($3, (select e."title" from "book_line" e where e."lineId" = p."lineId" and e."isCurrent" order by e."lang" limit 1), ''),
            p."ownerKind", p."ownerIds", coalesce(p."material", 0), $4, $5, $6, $7, $8
       from "book_page" p where p."lineId" = $1`,
    [row.lineId, row.lang, row.title, row.text, row.generatable, row.skipReason, row.userId, row.note, row.origin],
  );
}

/** The owners' names in this language, where the language has none, as accept has always done. */
async function nameOwnersIfUnnamed(client: PoolClient, lineId: string, lang: Lang, title: string | null, userId: string, note: string) {
  if (!title) return;
  const { rows } = await client.query<{ ownerKind: string | null; ownerIds: number[] | null }>(
    `select "ownerKind", "ownerIds" from "book_page" where "lineId" = $1`, [lineId]);
  const { ownerKind, ownerIds } = rows[0] ?? {};
  if (!ownerKind) return;
  for (const owner of ownerIds ?? []) {
    await nameIfUnnamed(client, { kind: ownerKind === "object" ? "gameobject" : "item", entityId: String(owner), lang, name: title, userId, note });
  }
}
```

After the `switch` writes a page, record the owner the client read it from when the corpus doesn't know that id yet. That's a renumbered Forever object (Khadgar's plaque: 696299 beside vmangos's 25333) or an item. Add, at the end of every case that writes (`correction`, `translation`, `new-page`, `new-book`):

```ts
      await addOwner(client, lineIdWritten, contribution.meta);
```

```ts
/**
 * The item or object the client read this page from, added to the page's owners when the
 * corpus does not have it: Forever renumbered some objects, and the next client to open one
 * finds the page by id rather than by its words.
 */
async function addOwner(client: PoolClient, lineId: string, meta: Record<string, string>): Promise<void> {
  for (const [kind, field] of [["item", "item"], ["object", "object"]] as const) {
    const id = Number(meta[field]);
    if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) continue;
    await client.query(
      `update "book_page" set "ownerKind" = coalesce("ownerKind", $2),
              "ownerIds" = array_append(coalesce("ownerIds", '{}'), $3)
        where "lineId" = $1 and ("ownerKind" is null or "ownerKind" = $2)
          and not ($3 = any(coalesce("ownerIds", '{}')))`,
      [lineId, kind, id],
    );
  }
}
```

Here `lineIdWritten` is `match.lineId` for a correction or translation, and the minted `lineId` for a new page or book. Add a test to Step 2: a translation row with `meta.object = "696299"` leaves `book_page.ownerIds` holding both the seeded id and 696299, and accepting a second row with the same id adds nothing.

Imports: `import { loadBookCorpus, matchBook } from "./book-match";` and `import { mintBookId, mintPageId } from "@/lib/readables/tools";`. `loadBookCorpus(client)` takes the transaction's client, so it reads rows the lock has serialised. Its `Queryable` type must accept `PoolClient`. If TypeScript objects, type the parameter as `Pick<PoolClient, "query">`.

In `resolveContribution`, the books branch drops the `contribution.locale !== BASE_LANG` condition and calls the new function:

```ts
    if (status === "accepted" && contribution.source === "books" && !written) {
      const refused = await acceptBookContribution(client, contribution, userId);
```

`contributedPageExists` also has to find a correction's version, whose note is the same `contribution #id`, so it needs no change. `booksInExplorer` finds any row by note instead of by `pageId`:

```ts
async function booksInExplorer(contributions: readonly Contribution[]): Promise<Set<number>> {
  const accepted = contributions.filter((c) => c.source === "books" && c.status === "accepted");
  if (accepted.length === 0) return new Set();
  const { rows } = await db().query<{ id: number }>(
    `select c."id" from unnest($1::int[]) as c("id")
      where exists (select 1 from "book_line" b where b."note" = 'contribution #' || c."id")`,
    [accepted.map((c) => c.id)],
  );
  return new Set(rows.map((row) => row.id));
}
```

- [ ] **Step 5: Run the tests**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/contributions src/lib/readables`
Expected: PASS. If the concurrency test is flaky, the lock key is wrong. Check that both rows' `meta.book` are identical after `trim()`.

- [ ] **Step 6: Commit**

```fish
git add apps/web/migrations/0075_book_line_structure_nullable.sql apps/web/src/lib/contributions/accept.ts apps/web/src/lib/contributions/accept.test.ts apps/web/src/lib/readables/catalogue.test.ts
git commit -m "Contributions: accepting a books row writes its page in any language, minting where needed"
```

### Task 9: Books on the Corrections tab, and known rows dropped at intake

**Files:**
- Modify: `apps/web/src/lib/contributions/known.ts` (`lineStates`, its docstring's "Zones and books are not compared here" sentence)
- Modify: `apps/web/src/lib/contributions/correction.ts` (`acceptCorrection` for books)
- Modify: `apps/web/src/app/[lang]/contributions/[source]/corrections/page.tsx:51` (allow `books`)
- Modify: `apps/web/src/components/CorrectionTable.tsx` only if it assumes a quest shape (read it; render `row.quest` only when present)
- Test: `apps/web/src/lib/contributions/known.test.ts`, `apps/web/src/lib/contributions/correction.test.ts`

**Interfaces:**
- Consumes: `matchBook`, `loadBookCorpus` (Task 6), `saveBookText` (Task 5b).
- Produces: `lineStates` returns `{ kind: "known" }` or `{ kind: "changed", lineId, variant: 0, current }` for books rows, and `MISSING` otherwise. `acceptCorrection` accepts books rows.

- [ ] **Step 1: Write the failing tests**

`known.test.ts`, seeding the same two-page book with English and esES text:

```ts
it("calls a books row with this language's words known, and other words changed", async () => {
  const [known, changed, missing] = await lineStates([
    { source: "books", locale: "esES", text: "Texto uno.", meta: { book: "Libro", number: "1" } },
    { source: "books", locale: "esES", text: "Words one.", meta: { book: "Libro", number: "1" } },
    { source: "books", locale: "esES", text: "Nada.", meta: { book: `Nuevo ${base}`, number: "1" } },
  ]);
  expect(known).toEqual({ kind: "known" });
  expect(changed).toEqual({ kind: "changed", lineId: `b:${base}`, variant: 0, current: "Texto uno." });
  expect(missing).toEqual({ kind: "missing" });
});
```

Here "Words one." is the English text of `b:${base}`, which the matcher finds by words: a correction of esES.

`correction.test.ts`:

```ts
it("accepts a books correction as the page's new words", async () => {
  const id = await booksRow({ locale: "esES", text: "Words one.", meta: { book: "Libro", number: "1" } });
  expect(await acceptCorrection(id, USER)).toMatchObject({ ok: true });
  const [state] = await lineStates([{ source: "books", locale: "esES", text: "Words one.", meta: {} }]);
  expect(state).toEqual({ kind: "known" });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/contributions/known.test.ts src/lib/contributions/correction.test.ts`
Expected: FAIL. Books rows come back `missing`, and `acceptCorrection` answers `not-a-correction`.

- [ ] **Step 3: `lineStates`**

At the top of `lineStates`, load the corpus once when any row is books:

```ts
  const books = rows.some((row) => row.source === "books" && row.text)
    ? await loadBookCorpus()
    : null;
```

In the per-row map, before the `row.source !== "quests"` check:

```ts
    if (row.source === "books") {
      if (!books || !row.text) return MISSING;
      const match = matchBook(
        { locale: row.locale, text: row.text, meta: row.meta, matchLineId: null, matchBookId: null, matchPageNumber: null, matchNewBook: false },
        books,
      );
      if (match.kind === "known") return { kind: "known" };
      if (match.kind === "correction") return { kind: "changed", lineId: match.lineId, variant: 0, current: match.current };
      return MISSING;
    }
```

Add `Comparable`'s row type fields only if `meta` is missing from it (it is `Pick<Submission, "source" | "locale" | "text" | "meta">`, so it is there). Replace the docstring's last paragraph with: "A books row is compared through the books matcher (book-match.ts): the same words on the page it matches are known, other words a correction. A zone has no text to compare."

A stored row's moderator answer (`matchLineId` and the others) is ignored here on purpose. Intake has none, and the corrections tab lists what the corpus disagrees with.

- [ ] **Step 4: `acceptCorrection` for books**

Replace the source guard:

```ts
  if ((contribution.source !== "quests" && contribution.source !== "books") || !contribution.text || !isLang(lang)) {
    return { ok: false, reason: "not-a-correction", message: "Only a quest line or a book page sent in a site language is a correction." };
  }
```

and add a books branch before the `lang === BASE_LANG` one:

```ts
    if (contribution.source === "books") {
      await saveBookText({ lineId: state.lineId, text: contribution.text, note: correctionNote(id), editedBy: userId, lang });
    } else if (lang === BASE_LANG) {
```

Import `saveBookText` and `BookMissing`/`BookConflict` from `@/lib/readables/text`, and add both to the `instanceof` list in the catch. Note that `setContributionMatch`'s one-way guard (Task 7) already lists `correctionNote`'s text.

- [ ] **Step 5: Open the corrections page to books**

`corrections/page.tsx`: `if (!["quests", "books"].includes((await params).source)) notFound();`. Pass `stage` filtering only for quests: wrap the `matchesStage` filter in `source === "quests" ? … : rows`. In `CorrectionTable.tsx`, wherever `row.quest` is read, guard with `row.quest &&`. The row's link goes to `/readables/r/${pageKeyOf(lineId)}` for books (compute it in the page).

Also show the Corrections sub-tab for books in `ContributionsTabs` if it is limited to quests: `grep -n "corrections" apps/web/src/components/ContributionsTabs.tsx`, and widen the condition to `source === "quests" || source === "books"`.

- [ ] **Step 6: Run the suites and look at the page**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/lib/contributions src/app/api/contributions; and pnpm --filter web typecheck`
Expected: PASS. On `spoken_dev`, `/contributions/readables/corrections` lists the Wiley-shaped rows with their diff.

- [ ] **Step 7: Commit**

```fish
git add -A apps/web/src/lib/contributions apps/web/src/app/[lang]/contributions apps/web/src/components
git commit -m "Contributions: book pages a client shows differently are corrections"
```

### Task 10: Bulk accept and the triage tabs agree with the matcher

**Files:**
- Modify: `apps/web/src/app/api/contributions/batch/route.ts` (whatever limits "Accept all matching" to rows with a `pageId`)
- Test: `apps/web/src/app/api/contributions/batch/route.test.ts`

**Interfaces:**
- Consumes: `matchBook` (Task 6).

- [ ] **Step 1: Find the books filter**

Run: `grep -n "pageId\|books" apps/web/src/app/api/contributions/batch/route.ts apps/web/src/lib/contributions/*.ts | grep -v test`

- [ ] **Step 2: Write the failing test**

In `route.test.ts`, add a case: two books rows, one whose words match a seeded page and one with a title two seeded books share. Accept all, and expect the first accepted and the second still `new`, with an error entry of reason `needs-page`.

- [ ] **Step 3: Run, fix, run**

The batch calls `resolveContribution` per row, which already refuses ambiguous rows (Task 8). Remove any books-specific pre-filter on `pageId` that would skip a row before it reaches `resolveContribution`.
Run: `pnpm --filter web exec vitest run src/app/api/contributions/batch`
Expected: PASS.

- [ ] **Step 4: Commit**

```fish
git add apps/web/src/app/api/contributions/batch
git commit -m "Contributions: accept all takes every books row the matcher places"
```

---

## PR 4: packs and the addon

### Task 11: A language pack carries the pages English lacks, and both checksums

**Files:**
- Modify: `pipelines/readables/tools/lib/lookup.mjs` (`localeEntries`, `packLua`, `buildLookup`'s queries)
- Modify: `pipelines/readables/tools/lib/lua.mjs` (`pageIndex` takes string ids and several texts per page)
- Test: `pipelines/readables/tools/lib/lookup.test.mjs`, `pipelines/readables/tools/lib/lua.test.mjs`

**Interfaces:**
- Produces, in a language's `Data/Sounds.lua`:
  - `index`/`loose`: as today, numeric ids only, for pages `Spoken_Books/Data/Books.lua` has. Each page appears under every checksum it has (current and extracted text).
  - `extraIndex`/`extraLoose`: the same shape, for pages `Books.lua` lacks. Ids are numbers, or quoted strings for minted pages.
  - `places = { [id] = { book = <id>, number = n } }` and `books = { [bookId] = { pages = { id, … } } }`: only for pages in `extraIndex`.
  - `pages[id]`: clips keyed the same way, `["n…"] = { file = "n…", … }` for a minted page.

- [ ] **Step 1: Write the failing tests**

`lua.test.mjs`:

```js
test("a page is found under each of its texts", () => {
  const { index } = pageIndex([
    { pageId: 38, bookId: 38, pageNumber: 1, titles: ["Nota de Wiley"], texts: ["Stoutmantle --", "Mantorrecio:"] },
  ]);
  const byChecksum = index.get("Nota de Wiley").get(1);
  assert.equal(byChecksum.get(pageChecksum("Stoutmantle --")), 38);
  assert.equal(byChecksum.get(pageChecksum("Mantorrecio:")), 38);
});

test("a minted page is written as a quoted key", () => {
  const lines = indexLua(pageIndex([{ pageId: "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11", bookId: "n1", pageNumber: 1, title: "X", text: "Y" }]), "extra");
  assert.ok(lines.some((line) => line.includes('= "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"')));
  assert.equal(lines[0], "\textraIndex = {");
});
```

`lookup.test.mjs`:

```js
test("a pack keeps pages English lacks out of the index older addons read", () => {
  const lua = packLua("esES", [
    { pageId: 38, file: "38", durationSec: 3 },
    { pageId: "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11", file: "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11", durationSec: 2 },
  ], {
    known: [{ pageId: 38, bookId: 38, pageNumber: 1, titles: ["Nota de Wiley"], texts: ["Mantorrecio:"] }],
    extra: [{ pageId: "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11", bookId: "n1", pageNumber: 1, titles: ["Instrucciones"], texts: ["Trotamundos"] }],
  });
  const index = lua.slice(lua.indexOf("\tindex = {"), lua.indexOf("\tloose = {"));
  assert.ok(!index.includes("n0b8f4e2a"));
  assert.match(lua, /\textraIndex = \{/);
  assert.match(lua, /\tplaces = \{\n\t\t\["n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"\] = \{ book = "n1", number = 1 \},/);
  assert.match(lua, /\tbooks = \{\n\t\t\["n1"\] = \{ pages = \{ "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11" \} \},/);
  assert.match(lua, /\["n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"\] = \{ file = "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11", len = 2/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test pipelines/readables/tools/lib/lua.test.mjs pipelines/readables/tools/lib/lookup.test.mjs`
Expected: FAIL.

- [ ] **Step 3: `lua.mjs`**

Add a Lua key/value writer, and let `pageIndex` take `texts` (several) or `text` (one):

```js
/** A page or book id as Lua writes it: a number bare, a minted id quoted. */
export function luaId(id) {
  return typeof id === "number" ? String(id) : quote(id);
}

function compareIds(a, b) {
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}
```

In `pageIndex`: sort with `compareIds(a.bookId, b.bookId) || a.pageNumber - b.pageNumber`, and replace the single checksum per page with a list:

```js
  const checksums = new Map(sorted.map((entry) => [entry.pageId, [...new Set((entry.texts ?? [entry.text]).map(pageChecksum))]]));
```

Then loop `for (const sum of checksums.get(entry.pageId))` where it set one, and in the `loose` pass. `indexLua(parts, prefix = "")` writes `\t${prefix ? `${prefix}Index` : "index"} = {` and `\t${prefix ? `${prefix}Loose` : "loose"} = {`, and every `${pageId}` value through `luaId(pageId)`. `booksLua` keeps calling `indexLua(pageIndex(sorted))` unchanged, and its own numeric tables are unchanged.

- [ ] **Step 4: `lookup.mjs`**

`packLua(lang, clips, entries)` takes `entries = { known, extra } | null`:

```js
  for (const row of clips) {
    const len = row.durationSec === null ? 0 : row.durationSec;
    const text = row.text == null ? "" : `, text = ${quote(spokenText(row.text))}`;
    lines.push(`\t\t[${luaId(row.pageId)}] = { file = "${row.file}", len = ${len}${text} },`);
  }
  lines.push("\t},");

  if (entries) {
    lines.push("", ...indexLua(pageIndex(entries.known)));
    if (entries.extra.length > 0) {
      // Pages Spoken_Books/Data/Books.lua lacks: found, placed and grouped from here. Older
      // versions of the addon read only `index` and `loose`, so they never meet an id they
      // cannot place.
      lines.push("", ...indexLua(pageIndex(entries.extra), "extra"), "", "\tplaces = {");
      for (const e of [...entries.extra].sort((a, b) => compareIds(a.pageId, b.pageId))) {
        lines.push(`\t\t[${luaId(e.pageId)}] = { book = ${luaId(e.bookId)}, number = ${e.pageNumber} },`);
      }
      lines.push("\t},", "", "\tbooks = {");
      const books = new Map();
      for (const e of [...entries.extra].sort((a, b) => a.pageNumber - b.pageNumber)) {
        if (!books.has(e.bookId)) books.set(e.bookId, []);
        books.get(e.bookId).push(e.pageId);
      }
      for (const bookId of [...books.keys()].sort(compareIds)) {
        lines.push(`\t\t[${luaId(bookId)}] = { pages = { ${books.get(bookId).map(luaId).join(", ")} } },`);
      }
      lines.push("\t},");
    }
  }
```

Export `compareIds` from `lua.mjs` as well, and import both helpers.

`buildLookup`'s clips query selects the key, not `pageId`. A minted page's id in the pack is its key string, and an extracted page's is its number:

```js
      `select case when p."pageTextId" is not null then p."pageTextId"::text else substr(p."lineId", 3) end as "pageId",
              p."pageTextId" is not null as "numeric", b."text", t."file", t."durationSec"
         from "take" t
         join "book_line" b on b."lineId" = t."lineId" and b."lang" = t."lang" and b."isCurrent"
         join "book_page" p on p."lineId" = t."lineId" and p."aliasOf" is null
        where t."source" = 'books' and t."isCurrent" and t."lang" = $1
        order by p."bookId", p."pageNumber"`,
```

Then `rows.map((r) => ({ ...r, pageId: r.numeric ? Number(r.pageId) : r.pageId }))`.

The locale pages query collects every text a client may show: each language's current text plus its newest extracted one. It also puts pages English's `Books.lua` lacks into `extra`:

```js
        pool.query(
          `select case when p."pageTextId" is not null then p."pageTextId"::text else substr(p."lineId", 3) end as "pageId",
                  p."pageTextId" is not null as "numeric",
                  p."bookId", p."pageNumber", p."ownerKind", coalesce(p."ownerIds", '{}') as "ownerIds",
                  exists (select 1 from "book_line" e where e."lineId" = p."lineId" and e."lang" = $2 and e."isCurrent") as "inEnglish",
                  array_remove(array[
                    (select c."text" from "book_line" c where c."lineId" = p."lineId" and c."lang" = $1 and c."isCurrent"),
                    (select x."text" from "book_line" x where x."lineId" = p."lineId" and x."lang" = $1 and x."origin" = 'extracted'
                      order by x."version" desc limit 1)
                  ], null) as "texts",
                  (select c."title" from "book_line" c where c."lineId" = p."lineId" and c."lang" = $1 and c."isCurrent") as "ownTitle"
             from "book_page" p
            where p."aliasOf" is null
              and exists (select 1 from "book_line" c where c."lineId" = p."lineId" and c."lang" = $1)`,
          [lang, LANG],
        ),
```

`localeEntries(pages, names)` then splits the pages:

```js
export function localeEntries(pages, names) {
  const byOwner = new Map(names.map((row) => [`${row.kind}:${row.entityId}`, row.name]));
  const known = [];
  const extra = [];
  for (const page of pages) {
    const kind = page.ownerKind === "object" ? "gameobject" : "item";
    const owned = page.ownerIds.map((id) => byOwner.get(`${kind}:${id}`)).filter(Boolean);
    const titles = [...new Set(owned.length ? owned : [page.ownTitle].filter(Boolean))].sort();
    const pageId = page.numeric ? Number(page.pageId) : page.pageId;
    const bookId = /^\d+$/.test(page.bookId) ? Number(page.bookId) : page.bookId;
    const entry = { pageId, bookId, pageNumber: page.pageNumber, texts: page.texts, titles };
    (page.inEnglish && page.numeric ? known : extra).push(entry);
  }
  return { known, extra };
}
```

`buildLookup` returns `pages: entries ? entries.known.length + entries.extra.length : null`.

Update the existing `lookup.test.mjs` and `lua.test.mjs` cases that pass `text` and get a flat `entries` array: wrap them in `{ known: [...], extra: [] }`.

- [ ] **Step 5: Run the tests and rebuild one pack**

Run: `make readables-test; and set -x DATABASE_URL postgres:///spoken_dev; and make readables-lookup LOCALE=esES`
Expected: tests pass. `build/readables/esES/Data/Sounds.lua` has an `extraIndex` once a minted esES page has a take, and otherwise an index that differs from the previous build only by added checksums.

- [ ] **Step 6: Commit**

```fish
git add pipelines/readables/tools/lib/lookup.mjs pipelines/readables/tools/lib/lookup.test.mjs pipelines/readables/tools/lib/lua.mjs pipelines/readables/tools/lib/lua.test.mjs
git commit -m "Books packs: pages English lacks, placed in the pack, and every text a client shows"
```

### Task 12: The addon finds, places and reads those pages

**Files:**
- Modify: `addons/Spoken_Books/Reader.lua` (`Find`, `PageOnScreen`, `PlaceOf`, `BookOf`)
- Modify: `addons/Spoken_Books/Audio.lua` (`ClipFor`, `HasAudio`)
- Modify: `addons/Spoken_Books/Core.lua:274-284` (`ReportURL`)
- Modify: `addons/Spoken_Books/Contribute.lua:40-45` (envelope ids, if the probe found any)
- Test: `tests/lua/readables_language_test.lua`, `tests/lua/readables_contribute_test.lua`

**Interfaces:**
- Consumes: the pack tables from Task 11.

- [ ] **Step 1: Write the failing tests** in `readables_language_test.lua`, using its `Install`

```lua
local MINTED = "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"
local PACK_ES = { addon = "SpokenReadablesAudio_esES", language = "esES",
    pages = { [MINTED] = { file = MINTED, len = 2, text = "Trotamundos." } },
    index = {}, loose = {},
    extraIndex = { ["Instrucciones"] = { [1] = { [stub.Checksum("Trotamundos.")] = MINTED } } },
    extraLoose = {},
    places = { [MINTED] = { book = "n1", number = 1 } },
    books = { ["n1"] = { pages = { MINTED } } } }

do
    Install({ PACK_ES }, "esES")
    stub.ShowItemText("Instrucciones", 1, "Trotamundos.")
    Expect(SpokenBooks:PageOnScreen() == MINTED, "an esES client finds a page only its pack knows")
    Expect(SpokenBooks:HasAudio(MINTED), "and has its audio")
    local clip = SpokenBooks:ClipFor(MINTED)
    Expect(clip and clip.path:find(MINTED .. ".mp3", 1, true), "read from the pack's own file")
    Expect(clip and clip.key == "b:" .. MINTED, "queued under its lineId")
    Expect(SpokenBooks:ReportURL(MINTED, "esES"):find("/readables/r/" .. MINTED, 1, true), "reported by its key")
end

do
    local old = { addon = PACK_ES.addon, language = "esES", pages = PACK_ES.pages, index = {}, loose = {} }
    Install({ old }, "esES")
    stub.ShowItemText("Instrucciones", 1, "Trotamundos.")
    Expect(SpokenBooks:PageOnScreen() == nil, "a pack without the extra tables finds nothing, as an older addon would")
end
```

Check `wow_client_stub` for the helpers that show a page and compute a checksum (`grep -n "ItemText\|Checksum" tests/lua/wow_client_stub.lua`). If `ShowItemText` or `Checksum` doesn't exist, add it to the stub. `ShowItemText(title, page, text)` sets what `ItemTextGetItem`, `ItemTextGetPage` and `ItemTextGetText` return. `Checksum(text)` calls `SpokenBooks:ChecksumOf(text)` after the addon loads, or reimplements `Checksum.lua`'s arithmetic for use before.

- [ ] **Step 2: Run them to see them fail**

Run: `luajit tests/lua/readables_language_test.lua`
Expected: FAIL, "an esES client finds a page only its pack knows".

- [ ] **Step 3: `Reader.lua`**

`Find` also tries the pack's extra tables:

```lua
local function Find(index, title, number, checksum)
	local byTitle = title and index.index and index.index[title]
	local byNumber = byTitle and byTitle[number]
	local found = byNumber and byNumber[checksum]
	if found then
		return found
	end
	found = index.loose and index.loose[checksum]
	if found then
		return found
	end

	-- A pack's own pages, which the corpus module does not have.
	byTitle = title and index.extraIndex and index.extraIndex[title]
	byNumber = byTitle and byTitle[number]
	return (byNumber and byNumber[checksum]) or (index.extraLoose and index.extraLoose[checksum])
end
```

`PlaceOf` and `BookOf` fall back to the installed packs:

```lua
--- Where a page sits: the corpus module's place, or a pack's for a page only it has.
function SpokenBooks:PlaceOf(pageId)
	local data = self:Data()
	local place = data and data.pages[pageId]
	if not place then
		for _, pack in ipairs(self:GetAudioPacks()) do
			place = pack.places and pack.places[pageId]
			if place then break end
		end
	end
	if not place then
		return nil, nil
	end
	return place.book, place.number
end

--- The book a page belongs to: its title and its pages in reading order.
function SpokenBooks:BookOf(pageId)
	local data = self:Data()
	local book = self:PlaceOf(pageId)
	if not book then
		return nil
	end
	if data and data.books[book] then
		return data.books[book]
	end
	for _, pack in ipairs(self:GetAudioPacks()) do
		if pack.books and pack.books[book] then
			return pack.books[book]
		end
	end
	return nil
end
```

- [ ] **Step 4: `Audio.lua`**

In `ClipFor`, replace `local place = self:Data() and self:Data().pages[pageId]` with:

```lua
	local bookId, number = self:PlaceOf(pageId)
	if not bookId then
		return nil
	end
	local place = (self:Data() and self:Data().pages[pageId]) or { book = bookId, number = number }
```

and replace `local book = self:Data().books[place.book]` with `local book = self:BookOf(pageId)`. A pack book has no `title`, so the existing `(book and book.title) or ""` falls through to `self.bookTitle[language][place.book]`, which `RememberPageText` fills from the client's own title. That's correct for a minted book.

In `HasAudio`, replace the `data.pages[pageId]` guard with `if not self:PlaceOf(pageId) then return false end`.

- [ ] **Step 5: `Core.lua`'s `ReportURL`**

```lua
function SpokenBooks:ReportURL(pageId, language)
	local key = type(pageId) == "number" and format("%d", pageId)
		or (type(pageId) == "string" and pageId:match("^n[%x%-]+$"))
	if not key then
		return nil
	end
	if language and language ~= self.BASE_LANGUAGE then
		return format("%s/%s/books/r/%s", self.SITE_URL, language, key)
	end
	return format("%s/books/r/%s", self.SITE_URL, key)
end
```

Keep the function's existing structure for the language branch. The only changes are `%s` instead of `%d`, and the key check.

- [ ] **Step 6: Envelope ids**

This builds on `feat/books-owner-lookup`, which adds `Spoken:BagItemID(title)` and reads the object entry from `UnitGUID("npc")`. Rebase onto it once it has merged, and use its helpers rather than a second copy. In `Contribute.lua`'s field list, after `{ "number", … }`:

```lua
		{ "item", (Spoken and Spoken.BagItemID and Spoken:BagItemID(ItemTextGetItem and ItemTextGetItem())) or "" },
		{ "object", SpokenBooks:ObjectEntry() or "" },
```

where `ObjectEntry` is the branch's GUID parse (the sixth `-`-separated field of a `GameObject-` GUID from `UnitGUID("npc")`). If the branch named it differently, use its name. Check `lib/contributions/envelope.ts` and accept `item` and `object` as optional digit fields. Add a case to `readables_contribute_test.lua`: with a bag item named like the title and an `npc` GUID stubbed, the envelope carries `item=9555` and `object=175761`.

The pack side mirrors the branch's `owners` table: in Task 11, also write `extraOwners = { object = { [entry] = bookId }, item = { [id] = bookId } }` for pages in `extraIndex`, and in Step 3 have `Find` try it by owner and page number before the checksum, as the branch does for `Books.lua`.

- [ ] **Step 7: Run every Lua test**

Run: `make test-player`
Expected: PASS, the whole suite.

- [ ] **Step 8: Commit**

```fish
git add addons/Spoken_Books tests/lua
git commit -m "Spoken Books: find, place and read pages only a language pack has"
```

### Task 13: Landing page and report route accept minted keys

**Files:**
- Modify: `apps/web/src/app/[lang]/readables/r/[pageId]/page.tsx` (docstring: the address is the page's key)
- Test: `apps/web/src/app/api/reports/route.test.ts` (books case)

- [ ] **Step 1: Write the failing test**

Add a case that posts a books report with `target` equal to a seeded minted page's key, and expects 201 with `lineId` equal to `b:<key>`.

- [ ] **Step 2: Run it**

Run: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --filter web exec vitest run src/app/api/reports/route.test.ts`
Expected: PASS already, if Task 4 changed `booksTarget` to `pageById(raw)`. If it fails, `booksTarget` still does `Number(raw)`: fix it to `pageById(raw)`.

- [ ] **Step 3: Update the docstring and commit**

Change "The address is /readables/r/{pageTextID}" to "The address is /readables/r/{key}: the pageTextID, or a minted page's n{uuid}".

```fish
git add apps/web/src/app/[lang]/readables/r apps/web/src/app/api/reports
git commit -m "Books: a minted page has a landing page and takes reports"
```

---

## PR 5: a minted page found in the world database

### Task 14: The import absorbs a minted page into the real one

**Files:**
- Create: `pipelines/readables/tools/lib/absorb.mjs`
- Modify: `pipelines/readables/tools/import.mjs` (call it after the loop)
- Test: `pipelines/readables/tools/lib/absorb.test.mjs`

**Interfaces:**
- Produces: `findAbsorptions(minted, extracted) -> { from: string, to: string }[]`, a pure function, and `absorb(client, { from, to })`.

A minted page is absorbed when some language's current text of it equals, after `normaliseText`, the same language's text of exactly one extracted page that no other minted page claims.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { findAbsorptions } from "./absorb.mjs";

test("a minted page whose words one extracted page has in the same language is that page", () => {
  const minted = [{ lineId: "b:nA", texts: { esES: "Trotamundos de los elfos:" } }];
  const extracted = [
    { lineId: "b:900", texts: { esES: "Trotamundos de los elfos:", enUS: "Elf travellers:" } },
    { lineId: "b:901", texts: { esES: "Otra cosa" } },
  ];
  assert.deepEqual(findAbsorptions(minted, extracted), [{ from: "b:nA", to: "b:900" }]);
});

test("two extracted candidates, or two minted claimants, absorb nothing", () => {
  const extracted = [{ lineId: "b:1", texts: { esES: "X" } }, { lineId: "b:2", texts: { esES: "X" } }];
  assert.deepEqual(findAbsorptions([{ lineId: "b:nA", texts: { esES: "X" } }], extracted), []);
  assert.deepEqual(findAbsorptions(
    [{ lineId: "b:nA", texts: { esES: "Y" } }, { lineId: "b:nB", texts: { esES: "Y" } }],
    [{ lineId: "b:3", texts: { esES: "Y" } }],
  ), []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test pipelines/readables/tools/lib/absorb.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```js
// A minted page later found in the world database: its texts, takes, reports and contributions
// move to the real page, and the minted row stays behind as an alias so a pack that shipped it
// still plays. Audio files are not renamed: a take keeps the file it was cut to.

import { normaliseText } from "./text.mjs";

const norm = (t) => normaliseText(t).trim();

export function findAbsorptions(minted, extracted) {
  const candidates = new Map();
  for (const page of minted) {
    const hits = new Set();
    for (const [lang, text] of Object.entries(page.texts)) {
      for (const real of extracted) if (real.texts[lang] !== undefined && norm(real.texts[lang]) === norm(text)) hits.add(real.lineId);
    }
    if (hits.size === 1) candidates.set(page.lineId, [...hits][0]);
  }
  const claims = new Map();
  for (const to of candidates.values()) claims.set(to, (claims.get(to) ?? 0) + 1);
  return [...candidates].filter(([, to]) => claims.get(to) === 1).map(([from, to]) => ({ from, to }));
}

/** Moves everything keyed on `from` to `to`, in the caller's transaction. */
export async function absorb(client, { from, to }) {
  // A language the real page already has keeps its own text; the minted one's becomes history.
  await client.query(
    `update "book_line" m set "isCurrent" = false
      where m."lineId" = $1 and exists (select 1 from "book_line" r where r."lineId" = $2 and r."lang" = m."lang" and r."isCurrent")`,
    [from, to],
  );
  await client.query(
    `update "book_line" m
        set "lineId" = $2,
            "version" = m."version" + coalesce((select max(r."version") from "book_line" r where r."lineId" = $2 and r."lang" = m."lang"), 0)
      where m."lineId" = $1`,
    [from, to],
  );
  for (const table of ["take", "report", "recording"]) {
    await client.query(`update "${table}" set "lineId" = $2 where "lineId" = $1 and "source" = 'books'`, [from, to]);
  }
  await client.query(`update "contribution" set "matchLineId" = $2 where "matchLineId" = $1`, [from, to]);
  await client.query(`update "book_page" set "aliasOf" = $2 where "lineId" = $1`, [from, to]);
}
```

Check that `report`, `recording` and `take` all have `"lineId"` and `"source"` columns (`\d take` and the others in `psql`). Drop any of them from the list that doesn't key on `lineId`. If two takes become `isCurrent` for one `(lineId, lang)`, keep the newer: add `update "take" set "isCurrent" = false where "lineId" = $2 and "source" = 'books' and "isCurrent" and "id" <> (select max("id") from "take" where "lineId" = $2 and "source" = 'books' and "isCurrent" and "lang" = take."lang")` after the take move.

In `import.mjs`, after the loop, inside the import's transaction:

```js
  const { rows: pageTexts } = await client.query(
    `select p."lineId", p."pageTextId" is null as "minted", jsonb_object_agg(l."lang", l."text") as "texts"
       from "book_page" p join "book_line" l on l."lineId" = p."lineId" and l."isCurrent"
      where p."aliasOf" is null group by p."lineId", p."pageTextId"`,
  );
  const absorptions = findAbsorptions(pageTexts.filter((p) => p.minted), pageTexts.filter((p) => !p.minted));
  for (const move of absorptions) await absorb(client, move);
  console.log(`${absorptions.length} minted pages found in the world database`);
```

- [ ] **Step 4: Run tests**

Run: `node --test pipelines/readables/tools/lib/absorb.test.mjs; and make readables-test`
Expected: PASS.

- [ ] **Step 5: Lookup keeps the old file playable**

A pack built after absorption keys the page under its real numeric id, and its take still points at file `n…`, which `pages[38] = { file = "n…" }` already handles. No alias table is needed in the pack. Add a `lookup.test.mjs` case asserting that a clip with a numeric `pageId` and file `"n…"` writes `[38] = { file = "n…", …}`.

- [ ] **Step 6: Commit**

```fish
git add pipelines/readables/tools/lib/absorb.mjs pipelines/readables/tools/lib/absorb.test.mjs pipelines/readables/tools/import.mjs pipelines/readables/tools/lib/lookup.test.mjs
git commit -m "Books: the import folds a minted page into the real one it turns out to be"
```

---

## A later release

### Task 15: Drop what nothing reads (ship one release after PR 3 is live)

**Files:**
- Create: `apps/web/migrations/00NN_book_line_structure_drop.sql`
- Modify: every writer still filling the columns (`text.ts`, `accept.ts`'s `insertText`, `import.mjs`, `import-locale.mjs`, `import_questit.py`, test fixtures); `store.ts` (`pageId` out of `CONTRIBUTION_COLUMNS` and `Contribution`)

- [ ] **Step 1:** Remove the structure columns from every insert. Run `grep -rn '"pageCount"\|"ownerIds"' apps/web/src pipelines` and expect only `book_page` reads to be left.
- [ ] **Step 2:** The migration: `alter table "book_line" drop column "pageId", drop column "bookId", drop column "pageNumber", drop column "pageCount", drop column "ownerKind", drop column "ownerIds", drop column "material"; alter table "contribution" drop column "pageId";`. Rewrite `entity_name_from_book_line` to read owners from `book_page` first, in the same migration.
- [ ] **Step 3:** Run every suite (`make web-test`, `make readables-test`, `make test-player`, quests pytest), then commit.

---

## Execution notes

- PR boundaries are where the user reviews and merges. Each PR targets `develop`, stacked on the previous one.
- Before each push, run every suite that PR touches against `spoken_ci_pin`.
- After PR 3 is deployed, the existing orphaned esES/koKR rows show their matches with no further work. Accepting them is the user's call in triage.
