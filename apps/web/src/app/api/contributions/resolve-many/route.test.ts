/**
 * Changing many contributions' status in one request.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

/** resolvedBy has a foreign key, so resolving needs a user that exists (contributions/store.test.ts). */
const RESOLVER = "test-contributions-resolve-many-route";

vi.mock("@/lib/generation/authz", () => ({
  requireCapability: async () => ({ session: { user: { id: RESOLVER } }, denied: null }),
  mayIgnoreIn: async () => false,
}));

import { RESOLVE_MANY_MAX } from "@/lib/contributions/contributions";

import { POST } from "./route";

/** A bucket no other run shares, so a concurrent run's cleanup can't race this one's rows. */
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;
const dedup = `test-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterEach(async () => {
  await asSystem.query(
    `delete from "activity" where "kind" = 'contribution.resolved'
        and "subject" in (select "id"::text from "contribution" where "ip" = $1)`,
    [ip],
  );
  await asSystem.query(`delete from "contribution" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions/resolve-many", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contributions/resolve-many", () => {
  it("resolves every row it is sent and answers each by id", async () => {
    // Readables, not quests: the plain status flip (accept.test.ts covers quest lines in a batch).
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip")
       values ('readables', '1', 'raw', $2, 'Words.', $1), ('readables', '2', 'raw', $3, 'More.', $1)
       returning "id"`,
      [ip, `${dedup}-a`, `${dedup}-b`],
    );
    const ids = rows.map((row) => row.id);
    const response = await POST(post({ ids: [...ids, 999_999_999], status: "rejected" }));
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results[ids[0]]).toEqual({ ok: true });
    expect(results[ids[1]]).toEqual({ ok: true });
    expect(results[999_999_999]).toEqual({ ok: false, error: "unknown contribution" });

    const { rows: statuses } = await asSystem.query<{ status: string }>(
      `select "status" from "contribution" where "id" = any($1::int[])`,
      [ids],
    );
    expect(statuses.map((row) => row.status)).toEqual(["rejected", "rejected"]);
  });

  describe("accepting readables rows", () => {
    let base: number;
    let lineIds: string[] = [];

    async function seedPage(lineId: string, bookId: string, pageNumber: number, texts: [string, string, string][]) {
      lineIds.push(lineId);
      await asSystem.query(
        `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber") values ($1, $2, $3, $4)`,
        [lineId, Number(lineId.slice(2)), bookId, pageNumber],
      );
      for (const [lang, title, text] of texts) {
        await asSystem.query(
          `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
           values ($1, $2, 1, true, 'extracted', $3, $4)`,
          [lineId, lang, title, text],
        );
      }
    }

    async function readablesRow(locale: string, text: string, meta: Record<string, string>): Promise<number> {
      const key = `test-${Math.random().toString(36).slice(2, 10)}`;
      const { rows } = await asSystem.query<{ id: number }>(
        `insert into "contribution" ("source", "key", "locale", "raw", "dedup", "text", "meta", "ip")
         values ('readables', $1, $2, 'raw', $1, $3, $4, $5) returning "id"`,
        [key, locale, text, JSON.stringify({ page: key, ...meta }), ip],
      );
      return rows[0].id;
    }

    const statusOf = async (id: number) =>
      (await asSystem.query<{ status: string }>(`select "status" from "contribution" where "id" = $1`, [id])).rows[0].status;

    beforeEach(async () => {
      base = 900_000_000 + Math.floor(Math.random() * 90_000_000);
      await seedPage(`b:${base}`, String(base), 1, [["enUS", `Tome ${base}`, `Words one ${base}.`]]);
      await seedPage(`b:${base + 10}`, String(base + 10), 1, [["enUS", `Dusty ${base}`, `Dust one ${base}.`]]);
      await seedPage(`b:${base + 20}`, String(base + 20), 1, [["enUS", `Dusty ${base}`, `Dust two ${base}.`]]);
    });

    afterEach(async () => {
      // What an accept minted for the new book's row, were one let through.
      const { rows: minted } = await asSystem.query<{ lineId: string }>(
        `select "lineId" from "book_line" where "title" = $1`,
        [`Brand New ${base}`],
      );
      lineIds.push(...minted.map((m) => m.lineId));
      await asSystem.query(`delete from "book_line" where "lineId" = any($1::text[])`, [lineIds]);
      await asSystem.query(`delete from "book_page" where "lineId" = any($1::text[])`, [lineIds]);
      lineIds = [];
    });

    it("accepts a translation, and leaves an ambiguous row and a new book unaccepted", async () => {
      const translation = await readablesRow("esES", `Words one ${base}.`, { book: "Libro", number: "1" });
      const ambiguous = await readablesRow("enUS", `Unseen ${base}.`, { book: `Dusty ${base}`, number: "1" });
      const fresh = await readablesRow("esES", `Nueva ${base}.`, { book: `Brand New ${base}`, number: "1" });

      const { results } = await (await POST(post({ ids: [translation, ambiguous, fresh], status: "accepted" }))).json();
      expect(results[translation]).toEqual({ ok: true });
      expect(results[ambiguous]).toMatchObject({ ok: false, error: expect.stringContaining("pick it first") });
      expect(results[fresh]).toMatchObject({ ok: false, error: expect.stringContaining("one row at a time") });

      expect(await statusOf(translation)).toBe("accepted");
      expect(await statusOf(ambiguous)).toBe("new");
      expect(await statusOf(fresh)).toBe("new");
      const { rows: minted } = await asSystem.query(`select 1 from "book_line" where "title" = $1`, [`Brand New ${base}`]);
      expect(minted).toEqual([]);
    });

    it("writes the first of two rows for one page and language, and refuses the second", async () => {
      await asSystem.query(`update "book_page" set "ownerKind" = 'item', "ownerIds" = $2 where "lineId" = $1`, [`b:${base}`, [base]]);
      const meta = { book: "Libro", number: "1", item: String(base) };
      const first = await readablesRow("esES", `Palabras ${base}.`, meta);
      const second = await readablesRow("esES", `Otras palabras ${base}.`, meta);

      const { results } = await (await POST(post({ ids: [first, second], status: "accepted" }))).json();
      const outcomes = [results[first], results[second]];
      expect(outcomes).toContainEqual({ ok: true });
      expect(outcomes).toContainEqual({ ok: false, error: expect.stringContaining("changed since you looked") });

      const { rows } = await asSystem.query<{ origin: string }>(
        `select "origin" from "book_line" where "lineId" = $1 and "lang" = 'esES'`,
        [`b:${base}`],
      );
      expect(rows).toEqual([{ origin: "contributed" }]);
    });

    it("accepts a row a moderator pointed at a page, and skips one the corpus already has", async () => {
      const pointed = await readablesRow("esES", `Otra cosa ${base}.`, { book: "Libro", number: "1" });
      await asSystem.query(`update "contribution" set "matchLineId" = $2 where "id" = $1`, [pointed, `b:${base + 10}`]);
      const known = await readablesRow("enUS", `Words one ${base}.`, { book: `Tome ${base}`, number: "1" });

      const { results } = await (await POST(post({ ids: [pointed, known], status: "accepted" }))).json();
      expect(results[pointed]).toEqual({ ok: true });
      expect(results[known]).toMatchObject({ ok: false, error: expect.stringContaining("already has these words") });
      expect(await statusOf(pointed)).toBe("accepted");
      expect(await statusOf(known)).toBe("new");
    });

    it("leaves a correction to the Corrections tab", async () => {
      const correction = await readablesRow("enUS", `Words won ${base}.`, { book: `Tome ${base}`, number: "1" });
      const { results } = await (await POST(post({ ids: [correction], status: "accepted" }))).json();
      expect(results[correction]).toMatchObject({ ok: false, error: expect.stringContaining("Corrections tab") });
      expect(await statusOf(correction)).toBe("new");
    });

    it("still rejects a new-book row", async () => {
      const fresh = await readablesRow("esES", `Nueva ${base}.`, { book: `Brand New ${base}`, number: "1" });
      const { results } = await (await POST(post({ ids: [fresh], status: "rejected" }))).json();
      expect(results[fresh]).toEqual({ ok: true });
    });
  });

  it("refuses a status it does not know", async () => {
    expect((await POST(post({ ids: [1], status: "maybe" }))).status).toBe(400);
  });

  it("refuses no ids, or more than one request takes", async () => {
    expect((await POST(post({ ids: [], status: "accepted" }))).status).toBe(400);
    const tooMany = Array.from({ length: RESOLVE_MANY_MAX + 1 }, (_, i) => i + 1);
    expect((await POST(post({ ids: tooMany, status: "accepted" }))).status).toBe(400);
  });
});
