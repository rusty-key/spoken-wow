/**
 * Narrating a boss story, against a real Postgres and a temporary take archive, with a fake
 * Speaker: nothing here reaches a provider or spends a credit.
 *
 * Builds its own instance at map -3 with random keys and ids, and removes it after.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Speaker, SpeakRequest } from "@/lib/generation/speakers/speaker";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bosses-regenerate-"));
process.env.SPOKEN_BOSSES_AUDIO_HISTORY = root;

// ffprobe cannot measure the fake clip, and the duration is not what is under test.
vi.mock("@/lib/places/tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/places/tools")>()),
  durationOf: async () => 1.5,
}));

const { closeDb, db } = await import("@/lib/db");
const { catalogue, loadContext } = await import("./catalogue");
const { regenerateBossLine } = await import("./regenerate");
const { search } = await import("./search");
const { saveStory } = await import("./story");

const MAP = -3;
let id: number;
let lineId: string;
let userId: string;
const spoken: string[] = [];

/** A Speaker that answers every request with a few bytes, and remembers what it was asked. */
const speaker: Speaker = {
  provider: "elevenlabs",
  modelId: "test-model",
  seedStrategy: "none",
  voices: async () => ({ ids: new Map([["narrator-male", "test-narrator"]]), error: null }),
  missing: (voice) => `no ${voice}`,
  speak: async (request: SpeakRequest) => {
    spoken.push(request.turns.map((turn) => turn.text).join(" "));
    return {
      ok: true,
      audio: Buffer.from(`clip ${spoken.length} ${Math.random()}`),
      leadIn: false,
      leadInSec: null,
      credits: 10,
      costUsd: null,
      words: null,
      made: {
        modelId: "test-model",
        settings: {},
        outputFormat: "mp3_44100_128",
        dictionaryId: null,
        dictionaryVersion: null,
      },
    };
  },
};

beforeAll(async () => {
  userId = `test-boss-regen-${Math.random().toString(36).slice(2, 10)}`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Boss Regen', $2, false)`,
    [userId, `${userId}@example.invalid`],
  );
});

beforeEach(async () => {
  spoken.length = 0;
  const key = `regen ${Math.random().toString(36).slice(2, 8)}`;
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
     values ($1, 'enUS', 1, true, 'rewritten', 'The first story.', 'test')`,
    [id],
  );
});

afterEach(async () => {
  await db().query(`delete from "take" where "source" = 'bosses' and "lineId" = $1`, [lineId]);
  await db().query(`delete from "boss_line" where "bossId" = $1`, [id]);
  await db().query(`delete from "boss" where "map" = $1`, [MAP]);
  await db().query(`delete from "boss_instance" where "map" = $1`, [MAP]);
});

afterAll(async () => {
  await db().query(`delete from "activity" where "actorId" = $1`, [userId]);
  await db().query(`delete from "user" where "id" = $1`, [userId]);
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

async function stateOf(lang: "enUS" | "deDE" = "enUS") {
  const result = search(await catalogue(lang), await loadContext(lang), { line: lineId });
  return result.lines[0];
}

describe("regenerateBossLine", () => {
  it("is a non-fatal failure for a boss with no story in the language", async () => {
    const result = await regenerateBossLine(lineId, userId, { speaker, lang: "deDE" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.message).toBe("no story in this language");
    expect(result.failure.fatal).toBe(false);
    expect(spoken).toEqual([]);
  });

  it("is a 404 for a line id that names no boss", async () => {
    const result = await regenerateBossLine(`boss:${MAP}:nobody`, userId, { speaker });
    expect(result.ok ? null : result.failure.status).toBe(404);
  });

  it("voices the current story, and an edit afterwards leaves that take stale", async () => {
    const first = await regenerateBossLine(lineId, userId, { speaker });
    expect(first.ok).toBe(true);
    expect(spoken).toEqual(["The first story."]);
    expect((await stateOf()).state).toBe("current");

    const before = (await catalogue("enUS")).find((entry) => entry.id === lineId)!.hash;
    await saveStory({ lang: "enUS", lineId, text: "The second story.", editedBy: userId });
    const after = (await catalogue("enUS")).find((entry) => entry.id === lineId)!.hash;
    expect(after).not.toBe(before);

    const stale = await stateOf();
    expect(stale.state).toBe("stale");
    expect(stale.take?.textHash).toBe(before);

    // Regenerating now cuts the take from the edited text.
    expect((await regenerateBossLine(lineId, userId, { speaker })).ok).toBe(true);
    expect(spoken).toEqual(["The first story.", "The second story."]);
    expect((await stateOf()).state).toBe("current");
  });
});
