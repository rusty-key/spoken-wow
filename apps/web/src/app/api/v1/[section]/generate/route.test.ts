/**
 * Generation through a token. The queue's writes, the speaker check and the worker are mocked:
 * nothing is enqueued and nothing reaches a provider.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Grant } from "@/lib/permissions";
import { asSystem } from "@/lib/teams/testing";

const mocks = vi.hoisted(() => ({
  grants: [] as Grant[],
  createBatch: vi.fn(async () => "batch-1"),
  enqueue: vi.fn(async (_b: string, jobs: unknown[]) => ({ queued: jobs.length, skipped: 0 })),
  requireSpeaker: vi.fn(),
}));

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: mocks.grants }),
}));
vi.mock("@/lib/generation/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/generation/queue")>()),
  createBatch: mocks.createBatch,
  enqueue: mocks.enqueue,
}));
vi.mock("@/lib/generation/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/generation/authz")>()),
  requireSpeaker: mocks.requireSpeaker,
}));
vi.mock("@/lib/generation/boot", () => ({ ensureQueueRunning: () => {}, queueWorker: () => null }));
vi.mock("@/lib/generation/preference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/generation/preference")>()),
  readPreference: async () => ({
    provider: "elevenlabs",
    elevenlabs: { modelId: "eleven_v3" },
    fish: { model: "s2-pro" },
  }),
}));
vi.mock("@/lib/api-key", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-key")>()),
  readApiKey: async () => null,
}));
vi.mock("@/lib/activity/store", () => ({ recordActivity: async () => {} }));

import { createFixtures, type Fixtures } from "@/lib/text-api/testing";
import { createToken } from "@/lib/tokens/store";

import { POST } from "./route";

let f: Fixtures;
let generateToken: string;
let readToken: string;

beforeAll(async () => {
  f = await createFixtures();
  await asSystem.query(
    `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text", "source")
     values ($1, 'enUS', 1, true, 'rewritten', 'The boss speaks at some length.', 'test')`,
    [f.boss.id],
  );
  const mint = async (access: "none" | "read", generate: boolean) =>
    (
      await createToken({
        userId: f.user,
        lang: "enUS",
        access,
        generate,
        label: "agent",
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).token;
  generateToken = await mint("none", true);
  readToken = await mint("read", false);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants = [
    { lang: "enUS", capability: "regenerate" },
    { lang: "enUS", capability: "text" },
  ];
  mocks.requireSpeaker.mockResolvedValue({ provider: "elevenlabs", denied: null });
});

afterAll(async () => {
  await f.remove();
  await closeDb();
});

const post = (token: string, body: unknown, section = "bosses") =>
  POST(
    new Request(`https://example.com/api/v1/${section}/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ section }) },
  );

describe("POST /api/v1/[section]/generate", () => {
  it("queues the items it is given", async () => {
    const response = await post(generateToken, { items: [{ id: f.boss.lineId }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ batchId: "batch-1", queued: 1, alreadyQueued: 0, matched: 1, unknown: [] });
    expect(mocks.enqueue).toHaveBeenCalledOnce();
  });

  it("prices a dry run and queues nothing", async () => {
    const response = await post(generateToken, { items: [{ id: f.boss.lineId }], dryRun: true });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body).toMatchObject({ dryRun: true, provider: "elevenlabs", files: 1, matched: 1, missingKeys: ["elevenlabs"] });
    expect(body.estimate.elevenlabs.characters).toBeGreaterThan(0);
    expect(mocks.createBatch).not.toHaveBeenCalled();
    expect(mocks.requireSpeaker).not.toHaveBeenCalled();
  });

  it("403s a read token, queuing nothing", async () => {
    const response = await post(readToken, { items: [{ id: f.boss.lineId }] });
    expect(response.status).toBe(403);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("403s once the owner loses regenerate", async () => {
    mocks.grants = [{ lang: "enUS", capability: "text" }];
    expect((await post(generateToken, { items: [{ id: f.boss.lineId }] })).status).toBe(403);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["filters outside quests", { filters: "q=a" }],
    ["both items and filters", { items: [{ id: "x" }], filters: "" }],
    ["neither", {}],
    ["an unknown key", { items: [{ id: "x" }], lang: "deDE" }],
    ["an empty items", { items: [] }],
    ["an item with no id", { items: [{}] }],
    ["a variant outside quests", { items: [{ id: "x", variant: 1 }] }],
    ["a label too long", { items: [{ id: "x" }], label: "x".repeat(101) }],
    ["dryRun that is not a boolean", { items: [{ id: "x" }], dryRun: "yes" }],
  ])("400 on %s", async (_name, body) => {
    expect((await post(generateToken, body)).status).toBe(400);
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["a typo key", "stat=stale"],
    ["a bad value", "state=bogus"],
    ["a pasted full URL", "https://spoken.quest/quests?state=stale"],
    ["lang=", "state=stale&lang=frFR"],
    ["a bad client", "client=nonsense"],
  ])("400 on filters with %s", async (_name, filters) => {
    const response = await post(generateToken, { filters }, "quests");
    expect(response.status).toBe(400);
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it("names the key it refused", async () => {
    const response = await post(generateToken, { filters: "stat=stale" }, "quests");
    expect(((await response.json()) as { error: string }).error).toContain("stat");
  });

  it("400 on a query string", async () => {
    const response = await POST(
      new Request("https://example.com/api/v1/bosses/generate?lang=deDE", {
        method: "POST",
        headers: { authorization: `Bearer ${generateToken}`, "content-type": "application/json" },
        body: JSON.stringify({ items: [{ id: f.boss.lineId }] }),
      }),
      { params: Promise.resolve({ section: "bosses" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("400 on an item with another key", async () => {
    expect((await post(generateToken, { items: [{ id: f.boss.lineId, lang: "deDE" }] })).status).toBe(400);
  });

  it("400 on 1001 items", async () => {
    const items = Array.from({ length: 1001 }, (_, i) => ({ id: `z:${-i}` }));
    expect((await post(generateToken, { items }, "places")).status).toBe(400);
  });

  it("400s an id found nowhere and names it", async () => {
    const response = await post(generateToken, { items: [{ id: "z:-1" }] }, "places");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "nothing to regenerate", unknown: ["z:-1"] });
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it("passes the speaker's 428 through, with no batch", async () => {
    mocks.requireSpeaker.mockResolvedValue({
      provider: "elevenlabs",
      denied: Response.json({ error: "no key" }, { status: 428 }),
    });
    expect((await post(generateToken, { items: [{ id: f.boss.lineId }] })).status).toBe(428);
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });
});
