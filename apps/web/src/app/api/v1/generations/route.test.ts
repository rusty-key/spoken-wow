/**
 * Watching and stopping a generation with real tokens, grants mocked. Jobs are seeded straight
 * into the queue and cancelled; nothing generates.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({
    role: null,
    grants: [
      { lang: "koKR", capability: "regenerate" },
      { lang: "koKR", capability: "text" },
    ],
  }),
}));

import { cancelPending, createBatch, enqueue } from "@/lib/generation/queue";
import { createToken } from "@/lib/tokens/store";

import { GET as one } from "./[batchId]/route";
import { POST as stop } from "./[batchId]/stop/route";
import { GET as list } from "./route";

const batches: string[] = [];
let owner: Awaited<ReturnType<typeof testUser>>;
let other: Awaited<ReturnType<typeof testUser>>;
let generateToken: string;
let readToken: string;
const prefix = `test-gen-${Math.random().toString(36).slice(2, 8)}`;

const mint = async (access: "none" | "read", generate: boolean) =>
  (
    await createToken({
      userId: owner.id,
      lang: "koKR",
      access,
      generate,
      label: "agent",
      expiresAt: new Date(Date.now() + 86_400_000),
    })
  ).token;

async function seed(userId: string): Promise<string> {
  const id = await createBatch("api batch", userId, "quests", "koKR");
  batches.push(id);
  await enqueue(
    id,
    [{ lineId: "q:1:accept", file: `${prefix}/${batches.length}.mp3`, npcName: "n", preview: "p", characters: 10 }],
    "quests",
    "koKR",
  );
  return id;
}

beforeAll(async () => {
  owner = await testUser("test-gen-owner");
  other = await testUser("test-gen-other");
  generateToken = await mint("none", true);
  readToken = await mint("read", false);
});

afterEach(async () => {
  for (const id of batches) await cancelPending("test cleanup", { batchId: id, langs: ["koKR"] });
  if (batches.length) {
    await asSystem.query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [batches]);
    batches.length = 0;
  }
});

afterAll(async () => {
  await owner.cleanup();
  await other.cleanup();
  await closeDb();
});

const req = (path: string, token: string, method = "GET") =>
  new Request(`https://example.com/api/v1/generations${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
const get = (id: string, token = generateToken) => one(req(`/${id}`, token), { params: Promise.resolve({ batchId: id }) });
const halt = (id: string, token = generateToken) =>
  stop(req(`/${id}/stop`, token, "POST"), { params: Promise.resolve({ batchId: id }) });

describe("generations", () => {
  it("reads a batch, stops it, and then shows it finished", async () => {
    const id = await seed(owner.id);
    const before = (await (await get(id)).json()) as { counts: { pending: number }; finished: boolean };
    expect(before.counts.pending).toBe(1);
    expect(before.finished).toBe(false);

    const stopped = await halt(id);
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ cancelled: 1 });

    expect(await (await get(id)).json()).toMatchObject({ finished: true, counts: { cancelled: 1 } });
  });

  it("lists the owner's batches", async () => {
    const id = await seed(owner.id);
    const body = (await (await list(req("", generateToken))).json()) as { batches: { batchId: string }[] };
    expect(body.batches.map((batch) => batch.batchId)).toContain(id);
  });

  it("404s another person's batch on read and stop, and leaves it pending", async () => {
    const id = await seed(other.id);
    expect((await get(id)).status).toBe(404);
    expect((await halt(id)).status).toBe(404);
    const { rows } = await asSystem.query(`select "state" from "regeneration_job" where "batchId" = $1`, [id]);
    expect(rows[0].state).toBe("pending");
  });

  it("404s an id that is not a uuid", async () => {
    expect((await get("not-a-uuid")).status).toBe(404);
    expect((await halt("not-a-uuid")).status).toBe(404);
  });

  it("403s a read token", async () => {
    const id = await seed(owner.id);
    expect((await get(id, readToken)).status).toBe(403);
    expect((await halt(id, readToken)).status).toBe(403);
    expect((await list(req("", readToken))).status).toBe(403);
  });
});
