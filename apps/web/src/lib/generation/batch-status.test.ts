/**
 * Against a real Postgres: whose batch it is, and in which language, are row filters.
 * Jobs are seeded and cancelled; nothing generates.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

import { listOwnBatches, ownBatch } from "./batch-status";
import { cancelPending, createBatch, enqueue } from "./queue";

const batches: string[] = [];
let a: Awaited<ReturnType<typeof testUser>>;
let b: Awaited<ReturnType<typeof testUser>>;
const prefix = `test-status-${Math.random().toString(36).slice(2, 8)}`;

async function seed(userId: string, name: string, lang: "koKR" | "deDE" = "koKR"): Promise<string> {
  const id = await createBatch(`batch ${name}`, userId, "quests", lang);
  batches.push(id);
  await enqueue(
    id,
    [{ lineId: `q:1:${name}`, file: `${prefix}/${name}.mp3`, npcName: "n", preview: "p", characters: 10 }],
    "quests",
    lang,
  );
  return id;
}

beforeAll(async () => {
  a = await testUser("test-status-a");
  b = await testUser("test-status-b");
});

afterEach(async () => {
  for (const id of batches) await cancelPending("test cleanup", { batchId: id, langs: ["koKR", "deDE"] });
  if (batches.length) {
    await asSystem.query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [batches]);
    batches.length = 0;
  }
});

afterAll(async () => {
  await a.cleanup();
  await b.cleanup();
  await closeDb();
});

describe("batch status", () => {
  it("lists only the owner's batches in the language, newest first", async () => {
    const first = await seed(a.id, "one");
    const second = await seed(a.id, "two");
    await seed(b.id, "other");
    await seed(a.id, "german", "deDE");
    await cancelPending("stopped", { batchId: second, langs: ["koKR"], by: a.id });

    const list = await listOwnBatches(a.id, "koKR");
    expect(list.map((batch) => batch.batchId)).toEqual([second, first]);
    expect(list[0].counts.cancelled).toBe(1);
    expect(list[0].finished).toBe(true);
    expect(list[1].counts.pending).toBe(1);
    expect(list[1].finished).toBe(false);
  });

  it("is null for another owner's batch and for another language", async () => {
    const mine = await seed(a.id, "mine");
    const theirs = await seed(b.id, "theirs");
    expect(await ownBatch(theirs, a.id, "koKR")).toBeNull();
    expect(await ownBatch(mine, a.id, "deDE")).toBeNull();
    expect(await ownBatch(mine, a.id, "koKR")).toMatchObject({ batchId: mine, failures: [] });
  });
});
