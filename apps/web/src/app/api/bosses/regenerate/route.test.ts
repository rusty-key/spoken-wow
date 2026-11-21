/**
 * The one-line regenerate route, against a real Postgres. The session, its grants and the
 * Speaker are mocked; the language check is the real requireIn, and the Speaker refuses to
 * be asked anything, so no test here can reach a provider.
 *
 * Builds its own instance at map -3 and removes it after.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { Grant } from "@/lib/permissions";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));

vi.mock("@/lib/session", () => ({ currentSession: async () => ({ user: { id: "test-boss-regen-route", role: null } }) }));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: viewer.grants }),
}));
vi.mock("@/lib/generation/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/generation/authz")>()),
  requireSpeaker: async () => ({
    speaker: {
      provider: "elevenlabs",
      modelId: "test-model",
      seedStrategy: "none",
      voices: async () => {
        throw new Error("the route test must not reach a provider");
      },
      missing: (voice: string) => voice,
      speak: async () => {
        throw new Error("the route test must not reach a provider");
      },
    },
    provider: "elevenlabs",
    key: "test-key",
    denied: null,
  }),
}));

import { POST } from "./route";

const MAP = -3;
let id: number;
let lineId: string;

beforeEach(async () => {
  viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
  const key = `regen route ${Math.random().toString(36).slice(2, 8)}`;
  id = -Math.floor(1e6 + Math.random() * 1e9);
  lineId = `boss:${MAP}:${key}`;
  await db().query(
    `insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, -3)`,
    [MAP],
  );
  await db().query(
    `insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, 0, $4)`,
    [id, MAP, key, [id]],
  );
  await db().query(
    `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text", "source")
     values ($1, 'enUS', 1, true, 'rewritten', 'An English story.', 'test')`,
    [id],
  );
});

afterEach(async () => {
  await db().query(`delete from "boss_line" where "bossId" = $1`, [id]);
  await db().query(`delete from "boss" where "map" = $1`, [MAP]);
  await db().query(`delete from "boss_instance" where "map" = $1`, [MAP]);
});

afterAll(closeDb);

function post(body: unknown, lang = "deDE"): Promise<Response> {
  return POST(
    new Request(`https://example.com/api/bosses/regenerate?lang=${lang}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/bosses/regenerate", () => {
  it("answers 403 to somebody without regenerate in the language", async () => {
    viewer.grants = [{ lang: "deDE", capability: "edit" }];
    expect((await post({ lineId })).status).toBe(403);
  });

  it("refuses a body with no lineId", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("answers a boss with no story in the language without voicing anything", async () => {
    const response = await post({ lineId });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "no story in this language", fatal: false });
  });
});
