/**
 * Planning and queueing a batch with the queue, the key check and the rate mocked: nothing
 * here reaches a provider or writes a job.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBatch: vi.fn(async () => "batch-1"),
  enqueue: vi.fn(async (_b: string, jobs: unknown[]) => ({ queued: jobs.length, skipped: 0 })),
  recordActivity: vi.fn(async () => {}),
  requireApiKey: vi.fn(),
  observedRate: vi.fn(),
  observedFishRate: vi.fn(),
}));

vi.mock("./queue", () => ({ createBatch: mocks.createBatch, enqueue: mocks.enqueue }));
vi.mock("@/lib/activity/store", () => ({ recordActivity: mocks.recordActivity }));
vi.mock("./authz", () => ({ requireApiKey: mocks.requireApiKey }));
vi.mock("./boot", () => ({ queueWorker: () => null }));
vi.mock("./calibration", () => ({ observedRate: mocks.observedRate, observedFishRate: mocks.observedFishRate }));
vi.mock("./preference", () => ({
  readPreference: async () => ({
    provider: "elevenlabs",
    elevenlabs: { modelId: "m" },
    fish: { model: "fm" },
  }),
}));

import type { CorpusLine } from "@/lib/corpus";

import { estimatePlan, linesForItems, queuePlan, type Plan } from "./batch-plan";

const line = (lineId: string, variant?: number) => ({ lineId, variant }) as unknown as CorpusLine;
const job = (file: string, characters: number, provider?: "fish") => ({
  lineId: file,
  file,
  npcName: "n",
  preview: "p",
  characters,
  provider,
});
const plan = (jobs: Plan["jobs"]): Plan => ({ jobs, matched: jobs.length, dropped: {}, unknown: [] });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiKey.mockResolvedValue({ key: "k", denied: null });
});

describe("linesForItems", () => {
  const lines = [line("q:5:accept", 0), line("q:5:accept~orc-male", 0), line("q:5:accept", 1), line("q:6:accept", 0)];

  it("matches every voice of an id and variant", () => {
    const { lines: found, unknown } = linesForItems(lines, [{ id: "q:5:accept", variant: 0 }]);
    expect(found).toEqual([lines[0], lines[1]]);
    expect(unknown).toEqual([]);
  });

  it("reports an id found nowhere", () => {
    expect(linesForItems(lines, [{ id: "q:9:accept", variant: 0 }])).toEqual({ lines: [], unknown: ["q:9:accept"] });
  });

  it("names an unknown variant with #", () => {
    expect(linesForItems(lines, [{ id: "q:6:accept", variant: 2 }]).unknown).toEqual(["q:6:accept#2"]);
  });

  it("returns only the variant asked for", () => {
    expect(linesForItems(lines, [{ id: "q:5:accept", variant: 1 }]).lines).toEqual([lines[2]]);
  });
});

describe("queuePlan", () => {
  const base = { section: "quests" as const, lang: "deDE" as const, userId: "u", provider: "elevenlabs" as const, label: "l" };

  it("refuses a batch with a fish job and no fish key, before any batch exists", async () => {
    mocks.requireApiKey.mockResolvedValue({ key: null, denied: Response.json({ error: "no fish key" }, { status: 428 }) });
    const result = await queuePlan({ ...base, plan: plan([job("a", 10, "fish"), job("b", 10)]) });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(428);
    expect(mocks.requireApiKey).toHaveBeenCalledWith("u", "fish");
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it("400s an empty plan without a batch", async () => {
    const result = (await queuePlan({ ...base, plan: { ...plan([]), unknown: ["x"] } })) as Response;
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: "nothing to regenerate", kind: "bad-request", unknown: ["x"] });
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it("queues, and records the token that queued it", async () => {
    const result = await queuePlan({ ...base, plan: plan([job("a", 10)]), tokenId: "tok" });
    expect(result).toEqual({ batchId: "batch-1", queued: 1, alreadyQueued: 0 });
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "batch.queued", detail: { batchId: "batch-1", label: "l", count: 1, apiTokenId: "tok" } }),
    );
  });

  it("leaves apiTokenId out when no token queued it", async () => {
    await queuePlan({ ...base, plan: plan([job("a", 10)]) });
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { batchId: "batch-1", label: "l", count: 1 } }),
    );
  });
});

describe("estimatePlan", () => {
  beforeEach(() => {
    mocks.observedRate.mockResolvedValue({ rate: 0.5, samples: 10, modelId: "m" });
    mocks.observedFishRate.mockResolvedValue({ rate: 0.00001, samples: 10, modelId: "fm", unit: "usd" });
  });

  it("prices distinct files at the observed rate", async () => {
    const result = await estimatePlan(plan([job("a", 100), job("b", 50)]), "u", "deDE", "elevenlabs");
    expect(result.elevenlabs).toMatchObject({ characters: 150, credits: 75 });
    expect(result.fish).toBeUndefined();
  });

  it("splits out fish jobs", async () => {
    const result = await estimatePlan(plan([job("a", 100), job("b", 50, "fish")]), "u", "deDE", "elevenlabs");
    expect(Object.keys(result).sort()).toEqual(["elevenlabs", "fish"]);
    expect(result.fish?.characters).toBe(50);
  });
});
