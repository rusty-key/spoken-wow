/**
 * The story route against a real Postgres, with only the session and its grants mocked, so
 * the language check is the real requireIn.
 *
 * Builds its own instance at map -2 with random keys and ids, and removes it after.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { Grant } from "@/lib/permissions";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));
const USER = vi.hoisted(() => `test-boss-story-${Math.random().toString(36).slice(2, 10)}`);

vi.mock("@/lib/session", () => ({ currentSession: async () => ({ user: { id: USER, role: null } }) }));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: viewer.grants }),
}));

import { GET, POST, PUT } from "./route";

const MAP = -2;
let id: number;
let lineId: string;

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Boss Story', $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(async () => {
  viewer.grants = [{ lang: "enUS", capability: "edit" }];
  const key = `story route ${Math.random().toString(36).slice(2, 8)}`;
  id = -Math.floor(1e6 + Math.random() * 1e9);
  lineId = `boss:${MAP}:${key}`;
  await db().query(
    `insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, -2)`,
    [MAP],
  );
  await db().query(
    `insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, 0, $4)`,
    [id, MAP, key, [id]],
  );
  await db().query(
    `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text", "source")
     values ($1, 'enUS', 1, true, 'rewritten', 'The first story.', 'test')`,
    [id],
  );
});

afterEach(async () => {
  await db().query(`delete from "boss_line" where "bossId" = $1`, [id]);
  await db().query(`delete from "boss" where "map" = $1`, [MAP]);
  await db().query(`delete from "boss_instance" where "map" = $1`, [MAP]);
});

afterAll(async () => {
  await db().query(`delete from "activity" where "actorId" = $1`, [USER]);
  await db().query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

function request(method: "PUT" | "POST", body: unknown, lang = "enUS"): Request {
  return new Request(`https://example.com/api/bosses/story?lang=${lang}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/bosses/story", () => {
  it("saves a new version and lists it in the history", async () => {
    const response = await PUT(request("PUT", { lineId, text: "The second story.", expectedVersion: 1 }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { version: { version: number } }).version.version).toBe(2);

    const history = await GET(
      new Request(`https://example.com/api/bosses/story?lang=enUS&lineId=${encodeURIComponent(lineId)}`),
    );
    const { versions } = (await history.json()) as { versions: { version: number; text: string }[] };
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].text).toBe("The second story.");
  });

  it("answers 409 to a save made against a version that has moved on", async () => {
    expect((await PUT(request("PUT", { lineId, text: "Someone else's.", expectedVersion: 1 }))).status).toBe(200);
    const stale = await PUT(request("PUT", { lineId, text: "Mine.", expectedVersion: 1 }));
    expect(stale.status).toBe(409);
  });

  it("answers 403 to somebody without edit in the language asked for", async () => {
    // Edit in English is no grant in German.
    viewer.grants = [{ lang: "enUS", capability: "edit" }, { lang: "deDE", capability: "regenerate" }];
    const response = await PUT(request("PUT", { lineId, text: "Eine Geschichte." }, "deDE"));
    expect(response.status).toBe(403);
  });

  it("answers 404 to a line id that names no boss", async () => {
    const response = await PUT(request("PUT", { lineId: `boss:${MAP}:nobody here`, text: "Text." }));
    expect(response.status).toBe(404);
  });

  it("refuses an empty text", async () => {
    expect((await PUT(request("PUT", { lineId, text: "  " }))).status).toBe(400);
  });
});

describe("POST /api/bosses/story", () => {
  it("restores an earlier version", async () => {
    await PUT(request("PUT", { lineId, text: "The second story." }));
    const response = await POST(request("POST", { lineId, version: 1 }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { version: { version: number } }).version.version).toBe(1);
  });

  it("answers 404 to a version the story never had", async () => {
    expect((await POST(request("POST", { lineId, version: 9 }))).status).toBe(404);
  });
});
