/**
 * The names route against a real Postgres, with only the session and its grants mocked, so
 * the language check is the real requireIn. Covers the boss kind, which /bosses renames with.
 *
 * Builds its own boss at map -2 with a random id, and removes it after.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { Grant } from "@/lib/permissions";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));
const USER = vi.hoisted(() => `test-names-${Math.random().toString(36).slice(2, 10)}`);

vi.mock("@/lib/session", () => ({ currentSession: async () => ({ user: { id: USER, role: null } }) }));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: viewer.grants }),
}));

import { catalogue } from "@/lib/bosses/catalogue";

import { GET, PUT } from "./route";

const MAP = -2;
let id: number;

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Names', $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(async () => {
  viewer.grants = [{ lang: "deDE", capability: "edit" }];
  id = -Math.floor(1e6 + Math.random() * 1e9);
  await db().query(
    `insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, -2)`,
    [MAP],
  );
  await db().query(
    `insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, 0, $4)`,
    [id, MAP, `names route ${id}`, [id]],
  );
  await db().query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ('boss', $1, 'enUS', 1, true, 'extracted', 'Mutanus the Devourer')`,
    [String(id)],
  );
});

afterEach(async () => {
  await db().query(`delete from "entity_name" where "kind" = 'boss' and "entityId" = $1`, [String(id)]);
  await db().query(`delete from "boss" where "map" = $1`, [MAP]);
  await db().query(`delete from "boss_instance" where "map" = $1`, [MAP]);
});

afterAll(async () => {
  await db().query(`delete from "activity" where "actorId" = $1`, [USER]);
  await db().query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

function put(body: unknown, lang = "deDE"): Promise<Response> {
  return PUT(
    new Request(`https://example.com/api/names?lang=${lang}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("PUT /api/names, kind boss", () => {
  it("names a boss by its id in the language, as an edited version the catalogue shows", async () => {
    // Built first, so the save has to move the catalogue's stamp to be seen.
    expect((await catalogue("deDE")).find((e) => e.bossId === id)).toMatchObject({ nameMissing: true });

    const response = await put({ kind: "boss", entityId: String(id), name: "Mutanus der Verschlinger" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { version: { version: number; origin: string } }).version).toMatchObject({
      version: 1,
      origin: "edited",
    });

    const history = await GET(new Request(`https://example.com/api/names?lang=deDE&kind=boss&entityId=${id}`));
    expect(history.status).toBe(200);
    const { versions } = (await history.json()) as { versions: { name: string }[] };
    expect(versions.map((v) => v.name)).toEqual(["Mutanus der Verschlinger"]);

    const entry = (await catalogue("deDE")).find((e) => e.bossId === id);
    expect(entry).toMatchObject({ name: "Mutanus der Verschlinger", nameMissing: false });
  });

  it("answers 403 to somebody without edit in the language asked for", async () => {
    viewer.grants = [{ lang: "enUS", capability: "edit" }, { lang: "deDE", capability: "regenerate" }];
    const response = await put({ kind: "boss", entityId: String(id), name: "Mutanus der Verschlinger" });
    expect(response.status).toBe(403);
  });

  it("answers 404 to a boss id with no English name", async () => {
    const response = await put({ kind: "boss", entityId: String(id - 1), name: "Niemand" });
    expect(response.status).toBe(404);
  });
});
