/**
 * Cache uploads, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

const USER = `test-broadcast-${Math.random().toString(36).slice(2, 10)}`;
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/session", () => ({ currentSession: async () => session.current }));

import { POST } from "./route";

// Ids no real BroadcastText row has, fresh per test so concurrent runs don't share them.
let base: number;

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Uploader', $2, false)
     on conflict ("id") do nothing`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(() => {
  base = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
  session.current = { user: { id: USER } };
});

afterEach(async () => {
  await db().query(`delete from "broadcast_text" where "broadcastTextId" between $1 and $1 + 10`, [base]);
});

afterAll(async () => {
  await db().query(`delete from "broadcast_text_upload" where "userId" = $1`, [USER]);
  await db().query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/broadcast-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function row(lang: string, id: number) {
  const { rows } = await db().query(
    `select "text", "text1", "build", "observations" from "broadcast_text"
      where "lang" = $1 and "broadcastTextId" = $2`,
    [lang, id],
  );
  return rows[0];
}

describe("POST /api/broadcast-text", () => {
  it("refuses a visitor who is not signed in", async () => {
    session.current = null;
    const response = await post({ lang: "deDE", build: 1, texts: [] });
    expect(response.status).toBe(401);
  });

  it("stores a language's rows and counts what was new", async () => {
    const response = await post({
      lang: "deDE",
      build: 70291,
      texts: [
        { id: base, text: "Willkommen, $n.", text1: "" },
        { id: base + 1, text: "", text1: "Seid gegrüßt." },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ texts: 2, added: 2, changed: 0 });
    expect(await row("deDE", base)).toEqual({
      text: "Willkommen, $n.", text1: "", build: 70291, observations: 1,
    });
  });

  it("lets a newer build's text replace an older one, and never the other way", async () => {
    await post({ lang: "deDE", build: 70245, texts: [{ id: base, text: "Alt.", text1: "" }] });

    const newer = await post({ lang: "deDE", build: 70291, texts: [{ id: base, text: "Neu.", text1: "" }] });
    expect(await newer.json()).toEqual({ texts: 1, added: 0, changed: 1 });

    const older = await post({ lang: "deDE", build: 70100, texts: [{ id: base, text: "Uralt.", text1: "" }] });
    expect(await older.json()).toEqual({ texts: 1, added: 0, changed: 0 });

    expect(await row("deDE", base)).toMatchObject({ text: "Neu.", build: 70291, observations: 3 });
  });

  it("refuses a cache that reads like English under a language's name", async () => {
    const english = [0, 1, 2, 3].map((i) => ({ id: base + i, text: `Hello ${i}.`, text1: "" }));
    await post({ lang: "enUS", build: 1, texts: english });

    const response = await post({ lang: "deDE", build: 1, texts: english });
    expect(response.status).toBe(400);
    expect(await row("deDE", base)).toBeUndefined();
  });

  it("drops malformed rows and keeps the rest", async () => {
    const response = await post({
      lang: "frFR",
      build: 1,
      texts: [{ id: -1, text: "x", text1: "" }, { id: base, text: 5, text1: "" }, { id: base + 2, text: "Salut.", text1: "" }],
    });
    expect(await response.json()).toEqual({ texts: 1, added: 1, changed: 0 });
  });

  it("refuses a language no game client runs in", async () => {
    expect((await post({ lang: "xxXX", build: 1, texts: [] })).status).toBe(400);
    expect((await post({ lang: "itIT", build: 1, texts: [] })).status).toBe(400);
  });
});
