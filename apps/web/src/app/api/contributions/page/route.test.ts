/**
 * Which page a readables contribution is, answered by whoever edits its language.
 *
 * Needs DATABASE_URL and migrations applied (0074).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

/** Every language the mocked viewer may edit; the route's gate asks about exactly one. */
const editable = new Set<string>();

vi.mock("@/lib/generation/authz", () => ({
  requireCapability: async (capability: string, lang: string) =>
    capability === "text" && editable.has(lang)
      ? { session: { user: { id: "test" } }, denied: null }
      : { session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) },
}));

// The session's "test" user does not exist, so a real insert would only log a foreign-key error.
const { recordActivity } = vi.hoisted(() => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/activity/store", () => ({ recordActivity }));

import { POST } from "./route";

/** A bucket no other run shares, so a concurrent run's cleanup can't race this one's rows. */
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;

afterEach(async () => {
  editable.clear();
  recordActivity.mockClear();
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await db().query(`delete from "book_line" where "lineId" = any($1::text[])`, [lineIds]);
  await db().query(`delete from "book_page" where "bookId" = $1`, [String(base)]);
  // The English name book_line's trigger gave the owner (0036).
  await db().query(`delete from "entity_name" where "kind" = 'item' and "entityId" = any($1::text[])`, [
    [base, base + 1].map(String),
  ]);
  await closeDb();
});

async function contribution(source = "readables"): Promise<number> {
  const { rows } = await db().query<{ id: number }>(
    `insert into "contribution" ("source", "key", "locale", "build", "meta", "raw", "dedup", "text", "ip")
     values ($3, '123456', 'ptBR', '1.15.7/1', '{"book": "Livro", "number": "2"}', 'raw', $2, 'Palavras.', $1)
     returning "id"`,
    [ip, `${ip}-${Math.random()}`, source],
  );
  return rows[0].id;
}

/**
 * A two-page English book of this run's own, so the test needs no imported corpus. Ids far
 * outside vmangos's, and the run's own, so a concurrent run never shares them.
 */
const base = 900_000_000 + Math.floor(Math.random() * 90_000_000);
const lineIds = [`b:${base}`, `b:${base + 1}`];

beforeAll(async () => {
  for (const pageNumber of [1, 2]) {
    const pageId = base + pageNumber - 1;
    await db().query(
      `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds")
       values ($1, $2, $3, $4, 'item', $5)`,
      [`b:${pageId}`, pageId, String(base), pageNumber, [pageId]],
    );
    await db().query(
      `insert into "book_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
          "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "text")
       values ($1, 'enUS', 1, true, 'extracted', $2, $3, $4, 2, 'A Test Tome', 'item', $5, 'Words.')`,
      [`b:${pageId}`, pageId, base, pageNumber, [pageId]],
    );
  }
});

async function matchOf(id: number) {
  const { rows } = await db().query(
    `select "matchLineId", "matchBookId", "matchPageNumber", "matchNewBook" from "contribution" where "id" = $1`, [id]);
  return rows[0];
}

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

  it("refuses a book that does not exist", async () => {
    const id = await contribution();
    editable.add("ptBR");
    expect((await POST(post({ id, bookId: "nope", pageNumber: 1 }))).status).toBe(400);
    expect(await matchOf(id)).toEqual({ matchLineId: null, matchBookId: null, matchPageNumber: null, matchNewBook: false });
  });

  it("logs the answer", async () => {
    const id = await contribution();
    editable.add("ptBR");
    await POST(post({ id, bookId: String(base), pageNumber: 9 }));
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "contribution.edited", subject: String(id), detail: { field: "match", value: { bookId: String(base), pageNumber: 9 } } }),
    );
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

  it("leaves a row that is not a book's alone", async () => {
    const id = await contribution("places");
    editable.add("ptBR");
    expect((await POST(post({ id, newBook: true }))).status).toBe(409);
  });
});
