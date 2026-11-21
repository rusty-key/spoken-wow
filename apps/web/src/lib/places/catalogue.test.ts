/**
 * Against a real Postgres, because what is being tested is a claim about SQL.
 *
 * The catalogue is memoised per process and this app runs two pm2 workers. The zones site
 * dropped its memo by hand after a save, which was correct only while its pm2 config
 * pinned one worker -- an edit saved by worker A left worker B serving the text from
 * before it. The replacement is a stamp every worker reads from the table, so the thing to
 * test is that the stamp moves for every way the table changes. A mocked database would
 * assert that a query was made, which is not the question.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { catalogueStamp } from "./catalogue";
import { currentLore, loreHistory } from "./lore";

/** A line id no other run shares, so tests can write rows without colliding. */
let lineId: string;

async function insert(
  version: number,
  isCurrent: boolean,
  full: string,
  lang = "enUS",
): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `insert into "lore_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key",
        "name", "full", "short")
     values ($1, $5, $2, $3, 'scraped', 1411, 'zone', null, 'Durotar', $4, 'short')
     returning "id"`,
    [lineId, version, isCurrent, full, lang],
  );
  return Number(rows[0].id);
}

beforeEach(() => {
  lineId = `z:test-${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  await db().query(`delete from "lore_line" where "lineId" = $1`, [lineId]);
});

afterAll(closeDb);

describe("the catalogue stamp", () => {
  it("moves when a line is edited, which inserts a version", async () => {
    await insert(1, true, "the first text");
    const before = await catalogueStamp();

    await db().query(`update "lore_line" set "isCurrent" = false where "lineId" = $1`, [lineId]);
    await insert(2, true, "the second text");

    expect(await catalogueStamp()).not.toBe(before);
  });

  /**
   * The case a row count and a maximum id both miss, and the reason the stamp sums the
   * live ids. A restore moves the flag between rows that already exist, so a worker that
   * only counted rows would go on serving the text the restore replaced until it died.
   */
  it("moves when a version is restored, which inserts nothing", async () => {
    const first = await insert(1, false, "the first text");
    await insert(2, true, "the second text");
    const before = await catalogueStamp();

    // Two statements, as restoreLore does it: the partial unique index is checked as each
    // row updates, so one statement flipping both would momentarily have two current rows
    // and be refused. That the restore has to be written this way is the whole reason it
    // leaves no new id behind for a stamp to notice.
    await db().query(`update "lore_line" set "isCurrent" = false where "lineId" = $1`, [lineId]);
    await db().query(`update "lore_line" set "isCurrent" = true where "id" = $1`, [first]);

    expect(await catalogueStamp()).not.toBe(before);
  });

  /** Nothing in the app deletes, but `make places-lore-import` and a hand-run scrape can. */
  it("moves when a version is deleted", async () => {
    await insert(1, false, "the first text");
    await insert(2, true, "the second text");
    const before = await catalogueStamp();

    await db().query(`delete from "lore_line" where "lineId" = $1 and "version" = 1`, [lineId]);

    expect(await catalogueStamp()).not.toBe(before);
  });

  it("does not move when nothing changed", async () => {
    await insert(1, true, "the first text");
    expect(await catalogueStamp()).toBe(await catalogueStamp());
  });
});

describe("the language a line is read in", () => {
  // lore_line is unique per (lineId, lang), so a translated row is a second live version of
  // the same line as far as any query that does not name its language is concerned.
  it("keeps a translation out of the English reads", async () => {
    await insert(1, true, "the English text");
    await insert(1, true, "o texto em portugues", "ptBR");

    expect((await currentLore()).get(lineId)?.full).toBe("the English text");
    expect((await currentLore("ptBR")).get(lineId)?.full).toBe("o texto em portugues");
    expect((await loreHistory(lineId)).map((v) => v.full)).toEqual(["the English text"]);
  });
});
