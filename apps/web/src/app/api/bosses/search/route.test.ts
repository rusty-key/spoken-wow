/**
 * The bosses explorer's read, against a real Postgres.
 *
 * Builds its own instance at map -2 and removes it after. The unseeded case swaps the
 * catalogue for an empty one, since the shared database may hold real bosses.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

vi.mock("@/lib/session", () => ({ currentSession: async () => null }));

const unseeded = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/bosses/catalogue", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/bosses/catalogue")>();
  return {
    ...real,
    catalogue: async (...args: Parameters<typeof real.catalogue>) =>
      unseeded.on ? [] : real.catalogue(...args),
  };
});

import { GET } from "./route";

const MAP = -2;
let id: number;
let key: string;

beforeEach(async () => {
  unseeded.on = false;
  key = `search route ${Math.random().toString(36).slice(2, 8)}`;
  id = -Math.floor(1e6 + Math.random() * 1e9);
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

type Body = { lines: { id: string; text: string | null; written: boolean }[]; total: number };

/** Narrowed to the test's boss by `line`: `instance` takes only positive maps. */
function get(extra = ""): Promise<Response> {
  const line = encodeURIComponent(`boss:${MAP}:${key}`);
  return GET(new Request(`https://example.com/api/bosses/search?line=${line}${extra}`));
}

describe("GET /api/bosses/search", () => {
  it("lists a boss with its story in the language", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.lines).toEqual([expect.objectContaining({ text: "An English story.", written: true })]);
  });

  it("answers 503 corpus_empty while the boss tables are unseeded", async () => {
    unseeded.on = true;
    const response = await get();
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("corpus_empty");
  });

  it("answers ids=1 with every matching id", async () => {
    expect(await (await get("&ids=1")).json()).toMatchObject({ ids: [`boss:${MAP}:${key}`], total: 1 });
  });

  it("answers ids=1 with only the bosses written in the language, which is what the queue takes", async () => {
    const other = id - 1;
    await db().query(
      `insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, 1, $4)`,
      [other, MAP, `${key} unwritten`, [other]],
    );
    const query = `q=${encodeURIComponent(key)}&field=name&ids=1`;
    const response = await GET(new Request(`https://example.com/api/bosses/search?${query}`));
    const body = (await response.json()) as { ids: string[]; total: number; totalChars: number };
    expect(body.ids).toEqual([`boss:${MAP}:${key}`]);
    expect(body.total).toBe(1);
    expect(body.totalChars).toBe("An English story.".length);
  });
});
