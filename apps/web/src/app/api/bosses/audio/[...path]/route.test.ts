/**
 * Which paths the audio route serves, against a real Postgres: the guard is the catalogue.
 *
 * Builds its own instance at map -2 and removes it after.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bosses-audio-route-"));
process.env.SPOKEN_BOSSES_AUDIO_HISTORY = root;

const { closeDb, db } = await import("@/lib/db");
const { GET } = await import("./route");

const MAP = -2;
let id: number;
let slug: string;

beforeEach(async () => {
  slug = `audio-route-${Math.random().toString(36).slice(2, 8)}`;
  id = -Math.floor(1e6 + Math.random() * 1e9);
  await db().query(
    `insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, -2)`,
    [MAP],
  );
  await db().query(
    `insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, 0, $4)`,
    [id, MAP, slug, [id]],
  );
});

afterEach(async () => {
  await db().query(`delete from "boss" where "map" = $1`, [MAP]);
  await db().query(`delete from "boss_instance" where "map" = $1`, [MAP]);
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

function get(rel: string): Promise<Response> {
  return GET(new Request(`https://example.com/api/bosses/audio/${rel}`), {
    params: Promise.resolve({ path: rel.split("/") }),
  });
}

describe("GET /api/bosses/audio/[...path]", () => {
  it("answers 404 to a file no boss owns", async () => {
    for (const rel of [`${MAP}/nobody-${slug}.mp3`, `${MAP}/${slug}`, "../../etc/passwd"]) {
      const response = await get(rel);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("no such boss audio");
    }
  });

  it("looks for a take of a file a boss owns", async () => {
    // No take has been cut, so the 404 is the store's, past the catalogue check.
    const response = await get(`${MAP}/${slug}.mp3`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("no audio for this line");
  });
});
