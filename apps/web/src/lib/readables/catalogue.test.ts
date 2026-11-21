/**
 * The catalogue lists every page book_page has, in each language, whether that language has
 * words for it or not.
 *
 * Needs DATABASE_URL and migrations applied (0074).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { catalogue, pageById } from "./catalogue";

const run = Math.random().toString(16).slice(2, 10);
const bookId = `n00000000-0000-4000-8000-${run.padEnd(12, "0")}`;
const lineId = `b:${bookId}`;

beforeAll(async () => {
  await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`, [lineId, bookId]);
  await db().query(
    `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
     values ($1, 'esES', 1, true, 'contributed', 'Instrucciones', 'Trotamundos.')`,
    [lineId],
  );
});

afterAll(async () => {
  await db().query(`delete from "book_line" where "lineId" = $1`, [lineId]);
  await db().query(`delete from "book_page" where "lineId" = $1`, [lineId]);
  await closeDb();
});

// An extracted page: numeric ids, an owner, English words, and a French rendering.
const owned = 2_000_000_000 + Math.floor(Math.random() * 1_000_000);
const ownedLine = `b:${owned}`;
const ownerId = String(owned);
// A page a client showed in the same book, with no owner of its own.
const mintedLine = `b:n00000000-0000-4000-8001-${run.padEnd(12, "0")}`;

async function ownedPage() {
  await db().query(
    `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds")
     values ($1, $2, $3, 1, 'item', array[$2::int])`,
    [ownedLine, owned, String(owned)],
  );
  for (const [lang, title, text] of [["enUS", "Old Tome", "Dust."], ["frFR", "Old Tome", "Poussiere."]]) {
    await db().query(
      `insert into "book_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId", "pageNumber",
          "pageCount", "title", "ownerKind", "ownerIds", "text")
       values ($1, $2, 1, true, 'extracted', $3, $3, 1, 1, $4, 'item', array[$3::int], $5)`,
      [ownedLine, lang, owned, title, text],
    );
  }
  await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 2)`, [mintedLine, String(owned)]);
  await db().query(
    `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
     values ($1, 'frFR', 1, true, 'contributed', 'Old Tome', 'Page deux.')`,
    [mintedLine],
  );
}

async function dropOwned() {
  await db().query(`delete from "book_line" where "lineId" = $1`, [mintedLine]);
  await db().query(`delete from "book_page" where "lineId" = $1`, [mintedLine]);
  await db().query(`delete from "book_line" where "lineId" = $1`, [ownedLine]);
  await db().query(`delete from "book_page" where "lineId" = $1`, [ownedLine]);
  await db().query(`delete from "entity_name" where "kind" = 'item' and "entityId" = $1`, [ownerId]);
}

describe("an owned page", () => {
  beforeAll(ownedPage);
  afterAll(dropOwned);

  it("lacks its title in a language that has not named the owner, and does not speak English's", async () => {
    const page = (await catalogue("frFR")).find((p) => p.id === ownedLine);
    expect(page?.missing?.title).toBe(true);
    expect(page?.spoken).not.toContain("Old Tome");
    const minted = (await catalogue("frFR")).find((p) => p.id === mintedLine);
    expect(minted?.missing?.title).toBe(true);
  });

  it("takes the owner's name where the language has one", async () => {
    await db().query(
      `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
       values ('item', $1, 'frFR', 1, true, 'extracted', 'Vieux Tome')`,
      [ownerId],
    );
    const page = (await catalogue("frFR")).find((p) => p.id === ownedLine);
    expect(page?.title).toBe("Vieux Tome");
    expect(page?.missing?.title).toBeFalsy();
    expect(page?.spoken).toContain("Vieux Tome");
  });

  it("titles an ownerless page of the book with the owner's name, not page 1's row", async () => {
    const minted = (await catalogue("frFR")).find((p) => p.id === mintedLine);
    expect(minted?.title).toBe("Vieux Tome");
    expect(minted?.missing?.title).toBeFalsy();
  });
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

  it("treats an empty title as none, and shows another language's", async () => {
    const blank = `b:n00000000-0000-4000-8002-${run.padEnd(12, "0")}`;
    await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`, [blank, blank.slice(2)]);
    try {
      await db().query(
        `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
         values ($1, 'esES', 1, true, 'contributed', '', 'Sin titulo.'), ($1, 'frFR', 1, true, 'contributed', 'Notice', 'Sans.')`,
        [blank],
      );
      const page = (await catalogue("esES")).find((p) => p.id === blank);
      expect(page?.title).toBe("Notice");
      expect(page?.missing?.title).toBe(true);
    } finally {
      await db().query(`delete from "book_line" where "lineId" = $1`, [blank]);
      await db().query(`delete from "book_page" where "lineId" = $1`, [blank]);
    }
  });

  it("finds it by its key", async () => {
    expect((await pageById(bookId, "esES"))?.id).toBe(lineId);
    expect(await pageById("../x", "esES")).toBeUndefined();
  });
});
