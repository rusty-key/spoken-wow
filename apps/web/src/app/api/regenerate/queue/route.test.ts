/**
 * What a bosses batch queues, against the real boss catalogue in Postgres. The session, the
 * queue's writes and the worker are mocked: nothing is enqueued and nothing generates.
 *
 * Builds its own instance at map -3 and removes it after.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

const { enqueue } = vi.hoisted(() => ({
  enqueue: vi.fn(async (_batchId: string, jobs: unknown[]) => ({ queued: jobs.length, skipped: 0 })),
}));

vi.mock("@/lib/generation/authz", () => ({
  requireIn: async (request: Request) => ({
    lang: new URL(request.url).searchParams.get("lang") || "enUS",
    session: { user: { id: "test-queue-bosses" } },
    denied: null,
  }),
  requireSpeaker: async () => ({ provider: "elevenlabs", denied: null }),
}));
vi.mock("@/lib/generation/boot", () => ({ ensureQueueRunning: () => {}, queueWorker: () => null }));
vi.mock("@/lib/generation/queue", () => ({ createBatch: async () => "batch-1", enqueue }));
vi.mock("@/lib/activity/store", () => ({ recordActivity: async () => {} }));

import { POST } from "./route";

const MAP = -3;
let ids: number[];
let written: string;
let unwritten: string;

async function boss(key: string, position: number, story: string | null): Promise<string> {
  const id = -Math.floor(1e6 + Math.random() * 1e9);
  ids.push(id);
  await db().query(
    `insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, $4, $5)`,
    [id, MAP, key, position, [id]],
  );
  if (story !== null) {
    await db().query(
      `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text", "source")
       values ($1, 'enUS', 1, true, 'rewritten', $2, 'test')`,
      [id, story],
    );
  }
  return `boss:${MAP}:${key}`;
}

beforeEach(async () => {
  ids = [];
  enqueue.mockClear();
  const tag = Math.random().toString(36).slice(2, 8);
  await db().query(
    `insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, -3)`,
    [MAP],
  );
  written = await boss(`written ${tag}`, 0, "A story worth telling.");
  unwritten = await boss(`unwritten ${tag}`, 1, null);
});

afterEach(async () => {
  await db().query(`delete from "boss_line" where "bossId" = any($1::int[])`, [ids]);
  await db().query(`delete from "boss" where "map" = $1`, [MAP]);
  await db().query(`delete from "boss_instance" where "map" = $1`, [MAP]);
});

afterAll(closeDb);

function post(lineIds: unknown): Promise<Response> {
  return POST(
    new NextRequest("https://example.com/api/regenerate/queue?lang=enUS", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "bosses", lineIds, label: "test" }),
    }),
  );
}

describe("POST /api/regenerate/queue, source bosses", () => {
  it("queues the bosses with a story in the language and drops the rest", async () => {
    const response = await post([written, unwritten, `boss:${MAP}:nobody`]);
    expect(response.status).toBe(200);

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [, jobs, source, lang] = enqueue.mock.calls[0] as unknown as [string, { lineId: string }[], string, string];
    expect(jobs.map((job) => job.lineId)).toEqual([written]);
    expect(jobs[0]).toMatchObject({ characters: "A story worth telling.".length });
    expect([source, lang]).toEqual(["bosses", "enUS"]);
  });

  it("answers 400 when nothing named has a story", async () => {
    expect((await post([unwritten])).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses lineIds that are not an array of strings", async () => {
    expect((await post("boss:1:x")).status).toBe(400);
  });
});
