/**
 * absorb() against a real Postgres: the readables pipeline has no database harness, so the
 * test lives where the web suite can run it.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "readables-absorb-"));
process.env.SPOKEN_READABLES_AUDIO_HISTORY = path.join(root, "audio-history");

vi.mock("server-only", () => ({}));

import { closeDb, db } from "@/lib/db";
import { pageById } from "./catalogue";
import { commitTake } from "@/lib/takes/commit";
import { absorb, foldMinted } from "@readables-tools/lib/absorb.mjs";

const n = 800_000_000 + Math.floor(Math.random() * 90_000_000);
const REAL = `b:${n}`;
const MINTED_FILE = `n${randomUUID()}`;
const MINTED = `b:${MINTED_FILE}`;
/** A second page of the minted book, for a book that keeps a live page after the fold. */
const MINTED_TWO = `b:n${randomUUID()}`;
/** Another language's minted copy of the real page, or a page minted into the real book. */
const MINTED_THREE = `b:n${randomUUID()}`;

async function line(lineId: string, lang: string, version: number, isCurrent: boolean, text: string) {
  await db().query(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
     values ($1, $2, $3, $4, 'extracted', 'T', $5)`,
    [lineId, lang, version, isCurrent, text],
  );
}

async function take(lineId: string, file: string, lang: string) {
  await db().query(
    `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
     values ('readables', $3, $2, $1, 1, true, 'generated', 1, (select "teamId" from "team_language" where "lang" = $3 and "privileged"))`,
    [lineId, file, lang],
  );
}

async function clean() {
  const ids = [REAL, MINTED, MINTED_TWO, MINTED_THREE];
  await db().query(`delete from "contribution" where "source" = 'readables' and "key" like $1`, [`absorb-${n}%`]);
  for (const table of ["take", "report", "recording"]) {
    await db().query(`delete from "${table}" where "lineId" = any($1)`, [ids]);
  }
  await db().query(`delete from "book_line" where "lineId" = any($1)`, [ids]);
  await db().query(`update "book_page" set "aliasOf" = null where "lineId" = any($1)`, [ids]);
  await db().query(`delete from "book_page" where "lineId" = any($1)`, [ids]);
}

beforeEach(async () => {
  await clean();
  await db().query(
    `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber")
     values ($1, $3::int, $3::int::text, 1), ($2, null, $4, 1)`,
    [REAL, MINTED, n, MINTED_FILE],
  );
  await line(REAL, "enUS", 1, true, "Elf travellers:");
  await line(REAL, "esES", 1, true, "Trotamundos de los elfos:");
  await line(MINTED, "esES", 1, false, "Old wording");
  await line(MINTED, "esES", 2, true, "Trotamundos de los elfos:");
  await line(MINTED, "frFR", 1, true, "Voyageurs elfes:");
  await take(REAL, String(n), "esES");
  await take(MINTED, MINTED_FILE, "esES");
  await db().query(
    `insert into "report" ("source", "lang", "lineId", "category", "body", "teamId")
     values ('readables', 'esES', $1, 'other', 'x', (select "teamId" from "team_language" where "lang" = 'esES' and "privileged"))`,
    [MINTED],
  );
  await db().query(
    `insert into "recording" ("source", "lang", "file", "lineId", "version", "format", "archiveFile", "bytes", "durationSec", "credit", "teamId")
     values ('readables', 'esES', $2, $1, 1, 'mp3', 'a', 1, 1, 'c', (select "teamId" from "team_language" where "lang" = 'esES' and "privileged"))`,
    [MINTED, MINTED_FILE],
  );
  await db().query(
    `insert into "contribution" ("source", "key", "raw", "dedup", "matchLineId")
     values ('readables', $1, 'r', $1, $2)`,
    [`absorb-${n}`, MINTED],
  );
});

afterEach(clean);
afterAll(async () => {
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

/** `work` in a transaction of its own, as the imports run absorb and foldMinted. */
async function inTx(work: (client: PoolClient) => Promise<unknown>) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await work(client);
    await client.query("commit");
  } finally {
    client.release();
  }
}

const fold = () => inTx((client) => absorb(client, { from: MINTED, to: REAL }));

async function bookAnswer(): Promise<number> {
  const { rows } = await db().query<{ id: number }>(
    `insert into "contribution" ("source", "key", "raw", "dedup", "matchBookId", "matchPageNumber")
     values ('readables', $1, 'r', $1, $2, 1) returning "id"`,
    [`absorb-${n}-book`, MINTED_FILE],
  );
  return rows[0].id;
}

const matchBookOf = async (id: number) =>
  (await db().query<{ matchBookId: string }>(`select "matchBookId" from "contribution" where "id" = $1`, [id])).rows[0]
    .matchBookId;

describe("absorb", () => {
  it("moves a minted page's texts, takes, reports, recordings and matches to the real page", async () => {
    await fold();

    const q = async (sql: string, p: unknown[]) => (await db().query(sql, p)).rows;
    expect(await q(`select count(*)::int as c from "book_line" where "lineId" = $1`, [MINTED])).toEqual([{ c: 0 }]);

    // The real page's own current text is unchanged; the minted one's is history; the
    // language the real page lacked is now current.
    const es = await q(
      `select "version", "isCurrent", "text" from "book_line" where "lineId" = $1 and "lang" = 'esES' order by "version"`,
      [REAL],
    );
    expect(es).toEqual([
      { version: 1, isCurrent: true, text: "Trotamundos de los elfos:" },
      { version: 2, isCurrent: false, text: "Old wording" },
      { version: 3, isCurrent: false, text: "Trotamundos de los elfos:" },
    ]);
    expect(await q(`select "isCurrent" from "book_line" where "lineId" = $1 and "lang" = 'frFR'`, [REAL])).toEqual([
      { isCurrent: true },
    ]);

    // Two takes were current for one (lineId, lang): the newer stays, both keep their file.
    const takes = await q(`select "file", "isCurrent" from "take" where "lineId" = $1 order by "id"`, [REAL]);
    expect(takes).toEqual([
      { file: String(n), isCurrent: false },
      { file: MINTED_FILE, isCurrent: true },
    ]);
    expect(await q(`select count(*)::int as c from "report" where "lineId" = $1`, [REAL])).toEqual([{ c: 1 }]);
    expect(await q(`select count(*)::int as c from "recording" where "lineId" = $1`, [REAL])).toEqual([{ c: 1 }]);
    expect(await q(`select "matchLineId" from "contribution" where "key" = $1`, [`absorb-${n}`])).toEqual([
      { matchLineId: REAL },
    ]);
    expect(await q(`select "aliasOf" from "book_page" where "lineId" = $1`, [MINTED])).toEqual([{ aliasOf: REAL }]);
  });

  it("leaves one current take per page and language when the real page's file is committed next", async () => {
    await fold();
    await commitTake("readables", String(n), Buffer.from("audio"), { lineId: REAL }, { lang: "esES" });
    const { rows } = await db().query(
      `select "file" from "take" where "lineId" = $1 and "lang" = 'esES' and "isCurrent"`,
      [REAL],
    );
    expect(rows).toEqual([{ file: String(n) }]);
    await db().query(`delete from "take" where "lineId" = $1`, [REAL]);
  });

  it("still finds the folded page by its minted key", async () => {
    await fold();
    const page = await pageById(MINTED.slice(2), "esES");
    expect(page?.id).toBe(REAL);
  });

  it("moves an answer naming the minted book to the real page's book once the minted book is empty", async () => {
    const id = await bookAnswer();
    await fold();
    expect(await matchBookOf(id)).toBe(String(n));
  });

  it("leaves an answer naming the minted book while the book has another live page", async () => {
    await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 2)`, [MINTED_TWO, MINTED_FILE]);
    const id = await bookAnswer();
    await fold();
    expect(await matchBookOf(id)).toBe(MINTED_FILE);
  });

  it("folds every minted page whose distinctive words are a real page's", async () => {
    await inTx(async (client) => expect(await foldMinted(client)).toBeGreaterThanOrEqual(1));
    const { rows } = await db().query(`select "aliasOf" from "book_page" where "lineId" = $1`, [MINTED]);
    expect(rows).toEqual([{ aliasOf: REAL }]);
  });

  it("folds a second minted copy into a real page that has absorbed one already", async () => {
    await fold();
    await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $1, 1)`, [MINTED_THREE]);
    await line(MINTED_THREE, "esES", 1, true, "Trotamundos de los elfos:");
    await inTx(foldMinted);
    const { rows } = await db().query(`select "aliasOf" from "book_page" where "lineId" = $1`, [MINTED_THREE]);
    expect(rows).toEqual([{ aliasOf: REAL }]);
  });

  it("moves a minted page that does not fold off the place the extract gives a real page", async () => {
    await db().query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 2)`, [MINTED_THREE, String(n)]);
    await line(MINTED_THREE, "deDE", 1, true, "Kurz");
    await inTx(async (client) => {
      // The extract now places a real page where the minted one sits.
      await client.query(`update "book_page" set "pageNumber" = 2 where "lineId" = $1`, [REAL]);
      await foldMinted(client);
    });
    const { rows } = await db().query(
      `select "lineId", "pageNumber" from "book_page" where "bookId" = $1 and "aliasOf" is null order by "pageNumber"`,
      [String(n)],
    );
    expect(rows).toEqual([
      { lineId: REAL, pageNumber: 2 },
      { lineId: MINTED_THREE, pageNumber: 3 },
    ]);
  });
});
