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
  storageRefusal: vi.fn(async (): Promise<{ kind: string; message: string } | null> => null),
}));

const catalogues = vi.hoisted(() => ({
  corpusLines: [] as unknown[],
  ignores: new Map<string, unknown>(),
  places: [] as unknown[],
  books: [] as unknown[],
  bosses: [] as unknown[],
  realFilters: false,
  /** Holds filtersFromParams back until it settles, when set. */
  filtersGate: null as Promise<void> | null,
}));

const searchContext = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({
    voiced: new Set<string>(),
    context: { overrides: new Map(), ignores: catalogues.ignores },
  })),
);

vi.mock("@/lib/quests/catalogue", () => ({ corpus: async () => ({ lines: catalogues.corpusLines }) }));
vi.mock("@/lib/quests/context", () => ({ searchContext }));
vi.mock("@/lib/search-request", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/search-request")>();
  return {
    ...original,
    filtersFromParams: async (params: URLSearchParams, lang: "enUS") => {
      await catalogues.filtersGate;
      return catalogues.realFilters ? original.filtersFromParams(params, lang) : { client: "focus" };
    },
  };
});
vi.mock("@/lib/places/catalogue", () => ({ catalogue: async () => catalogues.places }));
vi.mock("@/lib/readables/catalogue", () => ({ catalogue: async () => catalogues.books }));
vi.mock("@/lib/bosses/catalogue", () => ({ catalogue: async () => catalogues.bosses }));
vi.mock("@/lib/voices/references", () => ({ pinnedVoices: async () => new Set<string>() }));

vi.mock("./queue", () => ({ createBatch: mocks.createBatch, enqueue: mocks.enqueue }));
vi.mock("@/lib/activity/store", () => ({ recordActivity: mocks.recordActivity }));
vi.mock("./authz", () => ({ requireApiKey: mocks.requireApiKey }));
vi.mock("./boot", () => ({ queueWorker: () => null }));
vi.mock("@/lib/blobs/keep", () => ({ storageRefusal: mocks.storageRefusal }));
vi.mock("./calibration", () => ({ observedRate: mocks.observedRate, observedFishRate: mocks.observedFishRate }));
import { audioRelPath } from "@/lib/audio";
import type { CorpusLine } from "@/lib/corpus";

import {
  estimatePlan,
  FILTER_KEYS,
  filterError,
  linesForItems,
  planCatalogue,
  planQuestsByFilters,
  planQuestsByItems,
  queuePlan,
  type Plan,
} from "./batch-plan";
import { filtersFromParams, needsLevels, needsStale } from "@/lib/search-request";

import type { Preference } from "./preference";

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
  catalogues.ignores = new Map();
  catalogues.realFilters = false;
  catalogues.filtersGate = null;
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

  it("refuses a team whose bucket is failing, before any batch exists", async () => {
    mocks.storageRefusal.mockResolvedValueOnce({ kind: "storage-failing", message: "Your team's bucket is failing" });
    const result = (await queuePlan({ ...base, plan: plan([job("a", 10)]) })) as Response;
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: "Your team's bucket is failing", kind: "storage-failing" });
    expect(mocks.storageRefusal).toHaveBeenCalledWith("deDE");
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it("refuses a team that must keep its own storage and has none, before any batch exists", async () => {
    mocks.storageRefusal.mockResolvedValueOnce({ kind: "storage-required", message: "connect a bucket" });
    const result = (await queuePlan({ ...base, plan: plan([job("a", 10)]) })) as Response;
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: "connect a bucket", kind: "storage-required" });
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
  const preference = { provider: "elevenlabs", elevenlabs: { modelId: "m" }, fish: { model: "fm" } } as unknown as Preference;

  beforeEach(() => {
    mocks.observedRate.mockResolvedValue({ rate: 0.5, samples: 10, modelId: "m" });
    mocks.observedFishRate.mockResolvedValue({ rate: 0.00001, samples: 10, modelId: "fm", unit: "usd" });
  });

  it("prices distinct files at the observed rate", async () => {
    const result = await estimatePlan(plan([job("a", 100), job("b", 50)]), preference, "deDE", "elevenlabs");
    expect(result.elevenlabs).toMatchObject({ characters: 150, credits: 75 });
    expect(result.fish).toBeUndefined();
  });

  it("splits out fish jobs", async () => {
    const result = await estimatePlan(plan([job("a", 100), job("b", 50, "fish")]), preference, "deDE", "elevenlabs");
    expect(Object.keys(result).sort()).toEqual(["elevenlabs", "fish"]);
    expect(result.fish?.characters).toBe(50);
  });
});

const quest = (lineId: string, extra: Record<string, unknown> = {}) =>
  ({
    lineId,
    source: "accept",
    questId: 5,
    npcName: "n",
    npcType: "creature",
    race: "orc",
    gender: "m",
    flavor: null,
    voice: "orc-male",
    playerGender: null,
    text: "Hello there, traveller.",
    originalText: "Hello there, traveller.",
    fileName: lineId.replace(/\W/g, "-"),
    generatable: true,
    skipReason: null,
    lang: "enUS",
    ...extra,
  }) as unknown as CorpusLine;

describe("planQuestsByItems", () => {
  it("counts an ignored line as hidden, and nothing else", async () => {
    catalogues.corpusLines = [quest("q:5:accept"), quest("q:6:accept")];
    catalogues.ignores = new Map([["q:6:accept", {}]]);
    const result = await planQuestsByItems(
      [{ id: "q:5:accept", variant: 0 }, { id: "q:6:accept", variant: 0 }],
      "enUS",
      "elevenlabs",
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.matched).toBe(2);
    expect(result.dropped).toEqual({ hidden: 1 });
  });

  it("does not hide a line of a client the default view leaves out", async () => {
    catalogues.corpusLines = [quest("q:5:accept", { clientFamily: "anniversary" })];
    const result = await planQuestsByItems([{ id: "q:5:accept", variant: 0 }], "enUS", "elevenlabs");
    expect(result.jobs).toHaveLength(1);
    expect(result.dropped).toEqual({});
  });

  it("reads the context beside the default filters, which need neither staleness nor levels", async () => {
    catalogues.corpusLines = [quest("q:5:accept")];
    catalogues.realFilters = true;
    const defaults = await filtersFromParams(new URLSearchParams(), "enUS");
    expect([needsStale(defaults), needsLevels(defaults)]).toEqual([false, false]);

    let release = () => {};
    catalogues.filtersGate = new Promise<void>((resolve) => (release = resolve));
    const planned = planQuestsByItems([{ id: "q:5:accept", variant: 0 }], "enUS", "elevenlabs");
    await vi.waitFor(() => expect(searchContext).toHaveBeenCalledWith(false, false, "enUS", true, false));
    release();
    expect((await planned).jobs).toHaveLength(1);
  });

  it("plans a progress line as a job, like any other line", async () => {
    catalogues.corpusLines = [quest("q:5:progress", { source: "progress" })];
    const result = await planQuestsByItems([{ id: "q:5:progress", variant: 0 }], "enUS", "elevenlabs");
    expect(result.jobs).toHaveLength(1);
    expect(result.dropped).toEqual({});
  });
});

describe("planQuestsByFilters", () => {
  it("reads the pronunciation context for dirty=1, without which no line matches", async () => {
    catalogues.realFilters = true;
    await planQuestsByFilters("dirty=1", "enUS", "elevenlabs");
    expect(searchContext).toHaveBeenCalledWith(false, true, "enUS", true, false);
  });

  it("dirty=1 selects a dirty file's job and leaves out a clean one", async () => {
    const dirty = quest("q:5:accept");
    catalogues.corpusLines = [dirty, quest("q:6:accept")];
    catalogues.realFilters = true;
    // As searchContext does: the dirty set exists only when it is asked for.
    searchContext.mockImplementationOnce(async (_outdated, asked) => ({
      voiced: new Set<string>(),
      context: {
        overrides: new Map(),
        ignores: catalogues.ignores,
        ...(asked ? { dirty: new Set([audioRelPath(dirty)]) } : {}),
      },
    }));
    const result = await planQuestsByFilters("dirty=1", "enUS", "elevenlabs");
    expect(result.jobs.map((one) => one.file)).toEqual([audioRelPath(dirty)]);
  });

  it("does not read it otherwise", async () => {
    catalogues.realFilters = true;
    await planQuestsByFilters("q=hello", "enUS", "elevenlabs");
    expect(searchContext).toHaveBeenCalledWith(false, false, "enUS", true, false);
  });
});

describe("planCatalogue", () => {
  it("counts matched, drops by reason and lists each unknown id once", async () => {
    catalogues.places = [
      { id: "z:1", file: "places/1.mp3", spoken: "text", zoneName: "Z", short: "s", full: "f" },
      { id: "z:2", file: "places/2.mp3", spoken: "  ", zoneName: "Z", short: "s", full: "f" },
    ];
    const result = await planCatalogue("places", ["z:1", "z:2", "z:9", "z:9"], "enUS");
    expect(result.jobs.map((job) => job.lineId)).toEqual(["z:1"]);
    expect(result).toMatchObject({ matched: 2, dropped: { "no-text": 1 }, unknown: ["z:9"] });
  });

  it("drops an ungeneratable readable as not-generatable", async () => {
    catalogues.books = [
      { id: "b:1", file: "r/1.mp3", spoken: "text", title: "T", pageCount: 1, pageNumber: 1, generatable: false },
    ];
    const result = await planCatalogue("readables", ["b:1"], "enUS");
    expect(result).toMatchObject({ matched: 1, dropped: { "not-generatable": 1 }, unknown: [] });
    expect(result.jobs).toEqual([]);
  });
});

describe("filterError", () => {
  beforeEach(() => {
    catalogues.realFilters = true;
  });

  it.each(["", "state=stale&source=accept,gossip&page=3", "missing=1", "?q=hello&client=all", "minLevel=10&before=2026-01-01"])(
    "accepts %s",
    async (query) => {
      expect((await filterError(query, "enUS")).error).toBeNull();
    },
  );

  it.each([
    ["stat=stale", "stat"],
    ["progress=1", "progress"],
    ["state=bogus", "state"],
    ["lang=frFR", "lang"],
    ["https://spoken.quest/quests?q=x", "https"],
    ["source=nothing", "source"],
    ["source=accept,bgous", "source=bgous"],
    ["state=bogus&missing=1", "state=bogus"],
    ["minLevel=abc", "minLevel"],
    ["before=yesterday", "before"],
    ["before=2026-13-01", "before=2026-13-01"],
    ["after=2026-00-10", "after=2026-00-10"],
    ["ignored=yes", "ignored"],
    ["race=typo", "race=typo"],
    // A token has no site session, so the recordings are unknown and the filter would be dropped.
    ["rec=recorded", "rec needs a site session"],
    ["rec=typo", "rec needs a site session"],
    // Parsing reads the first; the second would be dropped.
    ["race=orc&race=typo", "race is given twice"],
  ])("refuses %s, naming %s", async (query, named) => {
    expect((await filterError(query, "enUS")).error).toContain(named);
  });

  it("knows every key the parser reads, and no other", async () => {
    const read = new Set<string>();
    class Recording extends URLSearchParams {
      override get(name: string) {
        read.add(name);
        return super.get(name);
      }
      override getAll(name: string) {
        read.add(name);
        return super.getAll(name);
      }
      override has(name: string) {
        read.add(name);
        return super.has(name);
      }
    }
    await filtersFromParams(new Recording(), "enUS");
    expect([...read].sort()).toEqual([...FILTER_KEYS].sort());
  });

  /** Taken as given, as in the Explorer: any value is a valid search. */
  const FREE_TEXT = ["q", "line", "model", "author"];

  it.each([...FILTER_KEYS].filter((key) => !FREE_TEXT.includes(key)))("refuses a junk value of %s", async (key) => {
    expect((await filterError(`${key}=zzjunk`, "enUS")).error).toContain(key);
  });

  it.each(FREE_TEXT)("takes any %s", async (key) => {
    expect(FILTER_KEYS.has(key)).toBe(true);
    expect((await filterError(`${key}=zzjunk`, "enUS")).error).toBeNull();
  });
});
