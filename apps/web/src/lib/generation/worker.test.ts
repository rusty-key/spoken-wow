/**
 * The queue is real, ElevenLabs is not.
 *
 * The store is a real Postgres for the reason queue.test.ts gives - the exclusions live in
 * the schema - while the one call that would cost money is injected, exactly as tts.ts and
 * elevenlabs.ts inject theirs. No test may need an account and none may ever spend credits.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db, POOL_MAX } from "@/lib/db";
import * as queue from "./queue";
import { createBatch, enqueue, type QueueEntry } from "./queue";
import { clampToPool } from "./concurrency";
import type { RegenerateResult } from "./regenerate";
import { backoffFor, startWorker } from "./worker";
import type { Source } from "@/lib/sections";

// The real boss generator would reach the catalogue and a provider; the dispatch to it is
// what is under test here, and lib/bosses/regenerate.test.ts covers what it does.
const regenerateBossLine = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bosses/regenerate", () => ({ regenerateBossLine }));

let prefix: string;
const batches: string[] = [];

function line(n: number): QueueEntry {
  return {
    lineId: `q:${n}:accept`,
    file: `${prefix}/${n}.mp3`,
    npcName: `NPC ${n}`,
    characters: 100,
    preview: `line ${n}`,
  };
}

const OK: RegenerateResult = {
  ok: true,
  lineId: "q:1:accept",
  file: "x",
  version: 1,
  bytes: 10,
  characters: 100,
  credits: 55,
  costUsd: null,
  seed: null,
  voice: "human-male",
  voiceId: "v",
  spokenText: "x",
  dictionaryVersion: null,
  sharedWith: 0,
};

async function seed(
  count: number,
  source: Source = "quests",
  provider: "elevenlabs" | "fish" = "elevenlabs",
): Promise<string> {
  const id = await createBatch("test", null as unknown as string, source);
  batches.push(id);
  await enqueue(id, Array.from({ length: count }, (_, i) => line(i + 1)), source, "enUS", provider);
  return id;
}

const users: string[] = [];

/** A real user row, because regeneration_batch."createdBy" references one. */
async function newUser(): Promise<string> {
  const id = `test-owner-${Math.random().toString(36).slice(2, 10)}`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $2, $3, false)`,
    [id, `Owner ${id}`, `${id}@example.invalid`],
  );
  users.push(id);
  return id;
}

/** Numbers files from 1000 up, so several owners' batches in one test never share a file. */
let nextLine = 1000;

async function seedFor(
  owner: string | null,
  count: number,
  provider: "elevenlabs" | "fish" = "elevenlabs",
): Promise<string> {
  const id = await createBatch("test", owner, "quests");
  batches.push(id);
  const lines = Array.from({ length: count }, () => line(nextLine++));
  await enqueue(id, lines, "quests", "enUS", provider);
  return id;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function statesOf(batchId: string): Promise<Record<string, number>> {
  const { rows } = await db().query<{ state: string; n: string }>(
    `select "state", count(*)::text as n from "regeneration_job"
      where "batchId" = $1 group by "state"`,
    [batchId],
  );
  return Object.fromEntries(rows.map((row) => [row.state, Number(row.n)]));
}

/** Poll until `check` passes or the deadline, so tests never race the drain loop. */
async function until(check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met in time");
}

beforeEach(() => {
  prefix = `test-worker-${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (batches.length) {
    await db().query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [batches]);
    batches.length = 0;
  }
  if (users.length) {
    await db().query(`delete from "user" where "id" = any($1::text[])`, [users]);
    users.length = 0;
  }
});

afterAll(async () => {
  await closeDb();
});

describe("backoffFor", () => {
  it("grows exponentially and is fully jittered", () => {
    expect(backoffFor(1, () => 1)).toBe(3_000);
    expect(backoffFor(2, () => 1)).toBe(6_000);
    expect(backoffFor(3, () => 1)).toBe(12_000);
    // Full jitter: anything from zero up to the ceiling, so retries do not resynchronise.
    expect(backoffFor(2, () => 0)).toBe(0);
  });
});

/**
 * The owner's key, injected.
 *
 * Every job is generated with the key of whoever queued it, so a worker built without this
 * reads the real `elevenlabs_key` table, finds no row for a seeded job's owner, and fails
 * the batch as unauthenticated before any of these tests get to their point. Sealing a key
 * into the test database instead would put a credential path in the way of tests that are
 * about the queue.
 */
const KEYED = async () => "test-key";

describe("startWorker", () => {
  it("drains the queue to empty", async () => {
    const batch = await seed(5);
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      regenerate: { quests: async () => OK },
      budget: async () => 3,
    });

    await until(async () => (await statesOf(batch)).done === 5);
    await worker.stop();
  });

  it("never exceeds the budget", async () => {
    const batch = await seed(10);
    let peak = 0;
    let live = 0;

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 3,
      regenerate: { quests: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 20));
        live -= 1;
        return OK;
      } },
    });

    await until(async () => (await statesOf(batch)).done === 10);
    await worker.stop();

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("claims nothing while it does not lead", async () => {
    const batch = await seed(3);
    const worker = startWorker(() => false, { apiKeyFor: KEYED, regenerate: { quests: async () => OK }});

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await statesOf(batch)).toEqual({ pending: 3 });

    await worker.stop();
  });

  /**
   * One job's failure is that job's, whatever its kind. A missing voice is one NPC's slot
   * in a batch that spans dozens of them, and even an account-wide failure - out of credits,
   * a bad key - is refused before anything is spent, so letting the rest fail on their own
   * costs nothing and never takes down lines that would have worked.
   */
  it("skips a job whose voice is missing and generates the rest", async () => {
    const batch = await seed(5);
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: { quests: async (lineId) =>
        lineId === "q:3:accept"
          ? {
              ok: false,
              failure: {
                kind: "voice-missing",
                message: 'no voice for "orc-female"',
                status: 409,
                fatal: true,
              },
            }
          : OK },
    });

    await until(async () => {
      const states = await statesOf(batch);
      return (states.done ?? 0) === 4 && (states.failed ?? 0) === 1;
    });
    await worker.stop();

    expect((await statesOf(batch)).cancelled).toBeUndefined();
    const { rows } = await db().query<{ stoppedBecause: string | null }>(
      `select "stoppedBecause" from "regeneration_batch" where "id" = $1`,
      [batch],
    );
    expect(rows[0].stoppedBecause).toBeNull();
  });

  it("fails each job on its own after a fatal failure rather than cancelling the batch", async () => {
    const batch = await seed(5);
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: { quests: async () => ({
        ok: false,
        failure: {
          kind: "quota",
          message: "quota_exceeded: you are out of credits",
          status: 402,
          fatal: true,
        },
      }) },
    });

    await until(async () => (await statesOf(batch)).failed === 5);
    await worker.stop();

    expect((await statesOf(batch)).cancelled).toBeUndefined();
  });

  /**
   * No request is made when the owner has no usable key, so nothing is spent by failing
   * each job in turn - and the batch's other lines are not cancelled on its account.
   */
  it("fails every job of an owner with no usable key, without generating", async () => {
    const batch = await seed(4);
    let generated = 0;
    const worker = startWorker(() => true, {
      apiKeyFor: async () => null,
      budget: async () => 1,
      regenerate: { quests: async () => {
        generated += 1;
        return OK;
      } },
    });

    await until(async () => (await statesOf(batch)).failed === 4);
    await worker.stop();

    expect(generated).toBe(0);
    expect((await statesOf(batch)).cancelled).toBeUndefined();

    const { rows } = await db().query<{ error: string }>(
      `select "error" from "regeneration_job" where "batchId" = $1 limit 1`,
      [batch],
    );
    expect(rows[0].error).toContain("ElevenLabs key");
  });

  // The job's language is what the generator is asked to speak: a Portuguese job handed on
  // as English would come back as an English take filed under the wrong language.
  it("hands the generator the job's language", async () => {
    const batch = await createBatch("test", null as unknown as string, "quests", "ptBR");
    batches.push(batch);
    await enqueue(batch, [line(1)], "quests", "ptBR");
    const seen: string[] = [];
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: { quests: async (_lineId, _userId, options) => {
        seen.push(options.lang);
        return OK;
      } },
    });

    await until(async () => (await statesOf(batch)).done === 1);
    await worker.stop();

    expect(seen).toEqual(["ptBR"]);
  });

  /**
   * The dispatch, which is what the source column is for. Handing a places job to the quests
   * generator would ask that corpus for a line id it has never heard of, and it would
   * answer "no line" once per job for the length of the batch.
   */
  it("sends a job to the generator for its own section", async () => {
    const batch = await seed(2, "places");
    const seen: string[] = [];

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: {
        quests: async (lineId) => {
          seen.push(`quests:${lineId}`);
          return OK;
        },
        places: async (lineId) => {
          seen.push(`places:${lineId}`);
          return OK;
        },
      },
    });

    await until(async () => (await statesOf(batch)).done === 2);
    await worker.stop();

    expect(seen).toHaveLength(2);
    expect(seen.every((entry) => entry.startsWith("places:"))).toBe(true);
  });

  it("hands a bosses job to regenerateBossLine when no generator is injected for it", async () => {
    const batch = await seed(2, "bosses");
    regenerateBossLine.mockImplementation(async (lineId: string) => ({ ...OK, lineId }));

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
    });

    await until(async () => (await statesOf(batch)).done === 2);
    await worker.stop();

    expect(regenerateBossLine).toHaveBeenCalledTimes(2);
    expect(regenerateBossLine.mock.calls.map((call) => call[2].lang)).toEqual(["enUS", "enUS"]);
  });

  it("keeps going after a failure that is not fatal", async () => {
    const batch = await seed(3);
    let first = true;

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: { quests: async () => {
        if (first) {
          first = false;
          return {
            ok: false as const,
            failure: {
              kind: "bad-request" as const,
              message: "its text still holds one of $<>",
              status: 422,
              fatal: false,
            },
          };
        }
        return OK;
      } },
    });

    await until(async () => {
      const states = await statesOf(batch);
      return (states.done ?? 0) === 2 && (states.failed ?? 0) === 1;
    });
    await worker.stop();
  });

  it("gives up on a rate-limited job after MAX_ATTEMPTS", async () => {
    const batch = await seed(1);
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      // Zero base, so the test does not wait out a real backoff.
      backoffMs: () => 0,
      regenerate: { quests: async () => ({
        ok: false,
        failure: {
          kind: "rate-limit",
          message: "too_many_concurrent_requests",
          status: 429,
          fatal: false,
        },
      }) },
    });

    await until(async () => (await statesOf(batch)).failed === 1);
    await worker.stop();

    const { rows } = await db().query<{ attempts: number }>(
      `select "attempts" from "regeneration_job" where "batchId" = $1`,
      [batch],
    );
    expect(rows[0].attempts).toBe(3);
  });

  it("fails a rate-limited job rather than requeueing it once its batch is stopped", async () => {
    const batch = await seed(1);
    await db().query(
      `update "regeneration_batch" set "stoppedAt" = now(), "stoppedBecause" = 'Stopped'
        where "id" = $1`,
      [batch],
    );

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      backoffMs: () => 0,
      regenerate: { quests: async () => ({
        ok: false,
        failure: {
          kind: "rate-limit",
          message: "too_many_concurrent_requests",
          status: 429,
          fatal: false,
        },
      }) },
    });

    await until(async () => (await statesOf(batch)).failed === 1);
    await worker.stop();

    // One attempt, not three: a retry would put the row back to `pending`, where it would be
    // claimed and paid for after someone pressed Stop - and where it would flip the queue
    // back to active, so the panel would return to "Regenerating" having just said "Stopped".
    const { rows } = await db().query<{ attempts: number }>(
      `select "attempts" from "regeneration_job" where "batchId" = $1`,
      [batch],
    );
    expect(rows[0].attempts).toBe(1);
  });
});

describe("per-owner queues", () => {
  /** Counts what each owner has in flight, and the most they ever had, from inside a generator. */
  function tracker() {
    const live = new Map<string, number>();
    const peak = new Map<string, number>();
    return {
      live,
      peak,
      enter(user: string) {
        live.set(user, (live.get(user) ?? 0) + 1);
        peak.set(user, Math.max(peak.get(user) ?? 0, live.get(user)!));
      },
      leave(user: string) {
        live.set(user, live.get(user)! - 1);
      },
    };
  }

  it("runs each owner's lane at the width of that owner's own key", async () => {
    const [small, large] = [await newUser(), await newUser()];
    const a = await seedFor(small, 6);
    const b = await seedFor(large, 6);
    const track = tracker();

    const worker = startWorker(() => true, {
      apiKeyFor: async (user) => `key-${user}`,
      budget: async (key) => (key === `key-${small}` ? 1 : 3),
      regenerate: {
        quests: async (_line, user) => {
          track.enter(user);
          await sleep(30);
          track.leave(user);
          return OK;
        },
      },
    });
    await until(async () => (await statesOf(a)).done === 6 && (await statesOf(b)).done === 6);
    await worker.stop();

    expect(track.peak.get(small)).toBe(1);
    expect(track.peak.get(large)).toBe(3);
  });

  it("keeps a fourth owner waiting until one of the first three queues drains", async () => {
    const owners = [await newUser(), await newUser(), await newUser(), await newUser()];
    for (const owner of owners) await seedFor(owner, 2);
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const worker = startWorker(() => true, {
      maxActive: 3,
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: {
        quests: async (_line, user) => {
          started.push(user);
          await gate;
          return OK;
        },
      },
    });
    await until(async () => started.length === 3);
    await sleep(200);
    expect(started).not.toContain(owners[3]);

    release();
    await until(async () => started.filter((user) => user === owners[3]).length === 2);
    await worker.stop();

    // The fourth owner started only after some other owner had started both of their jobs.
    expect(started.indexOf(owners[3])).toBeGreaterThanOrEqual(4);
  });

  it("halves only the lane that met a rate limit", async () => {
    const [limited, other] = [await newUser(), await newUser()];
    const a = await seedFor(limited, 12);
    const b = await seedFor(other, 16);
    let limitedAt: number | null = null;
    const track = tracker();

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 4,
      backoffMs: () => 0,
      regenerate: {
        quests: async (_line, user) => {
          if (user === limited && limitedAt === null) {
            limitedAt = Date.now();
            return {
              ok: false,
              failure: { kind: "rate-limit", message: "429", status: 429, fatal: false },
            };
          }
          // Measured once everything started before the 429 has settled (jobs take 40 ms, and
          // 100 leaves room for a slow claim), so the peak is what the worker chose after it,
          // not what was already in flight.
          const settled = limitedAt !== null && Date.now() - limitedAt > 100;
          if (settled) track.enter(user);
          await sleep(40);
          if (settled) track.leave(user);
          return OK;
        },
      },
    });
    await until(async () => (await statesOf(a)).done === 12 && (await statesOf(b)).done === 16);
    await worker.stop();

    expect(track.peak.get(limited)).toBeLessThanOrEqual(2);
    expect(track.peak.get(other)).toBe(4);
  });

  /**
   * A lane's width expires after a minute, and re-reading it is its owner's plan over the
   * network. The refresh here never answers: were it awaited, the pump would wait on it and
   * the rest of the queue would never be claimed. The clock is moved past the minute by
   * skewing Date.now rather than waiting, so nothing here depends on timing.
   */
  it("keeps draining on a lane's last width while its expired width is re-read", async () => {
    const owner = await newUser();
    const id = await seedFor(owner, 4);
    const realNow = Date.now.bind(Date);
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    let reads = 0;
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const worker = startWorker(() => true, {
      idleMs: 20,
      apiKeyFor: KEYED,
      budget: () => (++reads === 1 ? Promise.resolve(2) : new Promise<number>(() => {})),
      regenerate: {
        quests: async () => {
          started.push(started.length);
          await gate;
          return OK;
        },
      },
    });
    // The first two hold the lane open, so its width is cached rather than forgotten.
    await until(async () => started.length === 2);
    skew = 61_000;
    release();
    await until(async () => (await statesOf(id)).done === 4);
    await worker.stop();

    // One refresh started, however many pumps found the width stale while it hung.
    expect(reads).toBe(2);
  });

  it("never runs more than the pool can serve, however many lanes could use more", async () => {
    const owners = [await newUser(), await newUser(), await newUser(), await newUser()];
    const ids: string[] = [];
    for (const owner of owners) ids.push(await seedFor(owner, 10));
    let live = 0;
    let peak = 0;

    const worker = startWorker(() => true, {
      maxActive: 4,
      apiKeyFor: KEYED,
      budget: async () => 9,
      regenerate: {
        quests: async () => {
          live += 1;
          peak = Math.max(peak, live);
          await sleep(20);
          live -= 1;
          return OK;
        },
      },
    });
    await until(async () => {
      for (const id of ids) if ((await statesOf(id)).done !== 10) return false;
      return true;
    });
    await worker.stop();

    expect(peak).toBeLessThanOrEqual(clampToPool(Number.MAX_SAFE_INTEGER, POOL_MAX));
    expect(peak).toBeGreaterThan(9);
  });

  it("drains other queues while an active owner's only job is backing off", async () => {
    const [waiting, other] = [await newUser(), await newUser()];
    await seedFor(waiting, 1);
    const b = await seedFor(other, 3);
    const backedOff = await queue.claimNext(undefined, { owner: waiting, provider: "elevenlabs" });
    await queue.retryJob(backedOff!.id, 60_000);
    const seen: string[] = [];

    const worker = startWorker(() => true, {
      maxActive: 2,
      apiKeyFor: KEYED,
      budget: async () => 2,
      regenerate: {
        quests: async (_line, user) => {
          seen.push(user);
          return OK;
        },
      },
    });
    await until(async () => (await statesOf(b)).done === 3);
    await worker.stop();

    expect(seen).not.toContain(waiting);
  });
});

describe("stop()", () => {
  it("hands a claim already in flight back to the queue rather than starting it", async () => {
    const batch = await seed(1);

    // Holds the real claimNext round trip in flight so the test can land stop() in the
    // exact window the fix closes: after a claim has started, before it has resolved.
    let resolveClaimStarted!: () => void;
    const claimStarted = new Promise<void>((resolve) => {
      resolveClaimStarted = resolve;
    });
    let releaseClaim!: () => void;
    const realClaimNext = queue.claimNext;
    vi.spyOn(queue, "claimNext").mockImplementation(async (leaseMs) => {
      resolveClaimStarted();
      await new Promise<void>((resolve) => {
        releaseClaim = resolve;
      });
      return realClaimNext(leaseMs);
    });

    let regenerateCalls = 0;
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: { quests: async () => {
        regenerateCalls += 1;
        return OK;
      } },
    });

    await claimStarted;
    // running is still empty here - the claim has not resolved - so stop() has nothing
    // to await yet and returns almost immediately. Releasing the claim afterwards is
    // what lets it resolve with a job while `stopped` is already true.
    const stopped = worker.stop();
    releaseClaim();
    await stopped;

    // The row lands back in "pending" (via retryJob) only once the claim, now stopped,
    // has been handed back; poll rather than assume it beat this assertion.
    await until(async () => (await statesOf(batch)).pending === 1);

    expect(worker.inFlight()).toBe(0);
    expect(regenerateCalls).toBe(0);
  });

  it("awaits a job whose regenerate call is genuinely in flight before resolving", async () => {
    const batch = await seed(1);

    let resolveStarted!: () => void;
    const regenerateStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let releaseRegenerate!: () => void;

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: { quests: async () => {
        resolveStarted();
        await new Promise<void>((resolve) => {
          releaseRegenerate = resolve;
        });
        return OK;
      } },
    });

    await regenerateStarted;
    expect(worker.inFlight()).toBe(1);

    const stopPromise = worker.stop();
    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });

    // The regenerate call is still deliberately blocked, so stop() must still be
    // waiting on it - dropping it here is exactly what would bill ElevenLabs for audio
    // nobody gets. A couple of microtask ticks is enough to prove it has not resolved
    // early without depending on wall-clock timing.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseRegenerate();
    await stopPromise;

    expect(worker.inFlight()).toBe(0);
    expect(await statesOf(batch)).toEqual({ done: 1 });
  });
});

describe("a fish.audio batch", () => {
  const SETTINGS = { model: "s2.1-pro-free", temperature: 0.5, topP: 0.6, speed: 1.1 };
  const ELEVEN = {
    modelId: "eleven_v3",
    voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
    seedStrategy: "npc" as const,
  };

  it("runs on the provider it was queued with, with the owner's fish.audio key and settings", async () => {
    const batch = await seed(1, "quests", "fish");
    const asked: string[] = [];
    const seen: string[] = [];

    const worker = startWorker(() => true, {
      apiKeyFor: async (_user, provider) => {
        asked.push(provider);
        return `${provider}-key`;
      },
      preferenceFor: async () => ({ fish: SETTINGS, elevenlabs: ELEVEN }),
      budget: async () => 1,
      regenerate: {
        quests: async (_line, _user, options) => {
          seen.push(options.speaker.provider);
          return { ...OK, credits: null, costUsd: 0.001 };
        },
      },
    });
    await until(async () => (await statesOf(batch)).done === 1);
    await worker.stop();

    // Twice, not once: the lane's width is read once (apiKeyFor, cached 60s per lane) before
    // the claim, and run() reads its own job's key again to generate with - two calls that
    // happen to ask the same lane's key here because there is only one job.
    expect(asked).toEqual(["fish", "fish"]);
    expect(seen).toEqual(["fish"]);
    const { rows } = await db().query(`select "costUsd"::float8 as usd from "regeneration_job" where "batchId" = $1`, [batch]);
    expect(rows[0].usd).toBeCloseTo(0.001);
  });

  it("fails, naming fish.audio, when the owner has no fish.audio key", async () => {
    const batch = await seed(2, "quests", "fish");
    const worker = startWorker(() => true, {
      apiKeyFor: async (_user, provider) => (provider === "fish" ? null : "eleven-key"),
      budget: async () => 1,
      regenerate: { quests: async () => OK },
    });
    await until(async () => (await statesOf(batch)).failed === 2);
    await worker.stop();

    const { rows } = await db().query<{ error: string }>(
      `select "error" from "regeneration_job" where "batchId" = $1 and "state" = 'failed'`,
      [batch],
    );
    expect(rows[0].error).toMatch(/no usable fish\.audio key/);
    expect((await statesOf(batch)).cancelled).toBeUndefined();
  });

  it("sizes a lane by its owner's provider and model", async () => {
    const batch = await seed(2, "quests", "fish");
    const budgets: string[] = [];
    const worker = startWorker(() => true, {
      apiKeyFor: async (_user, provider) => `${provider}-key`,
      preferenceFor: async () => ({ fish: SETTINGS, elevenlabs: ELEVEN }),
      budget: async (_key, provider, model) => {
        budgets.push(`${provider}:${model}`);
        return 1;
      },
      regenerate: { quests: async () => OK },
    });
    await until(async () => (await statesOf(batch)).done === 2);
    await worker.stop();

    expect(budgets).toContain("fish:s2.1-pro-free");
  });

  it("runs one owner's ElevenLabs and fish.audio lanes together, as one queue", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    await seedFor(alice, 2, "elevenlabs");
    await seedFor(alice, 2, "fish");
    await seedFor(bob, 2, "elevenlabs");
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const worker = startWorker(() => true, {
      maxActive: 1,
      apiKeyFor: async (_user, provider) => `${provider}-key`,
      preferenceFor: async () => ({ fish: SETTINGS, elevenlabs: ELEVEN }),
      budget: async () => 1,
      regenerate: {
        quests: async (_line, user, options) => {
          started.push(`${user}:${options.speaker.provider}`);
          await gate;
          return OK;
        },
      },
    });
    await until(async () => started.length === 2);
    await sleep(200);
    release();
    await worker.stop();

    expect(started.slice(0, 2).sort()).toEqual([`${alice}:elevenlabs`, `${alice}:fish`]);
  });
});

describe("a settings read that fails", () => {
  it("fails that job and keeps the worker running, rather than rejecting unawaited", async () => {
    const batch = await seed(2);
    let calls = 0;
    const worker = startWorker(() => true, {
      apiKeyFor: async () => "eleven-key",
      preferenceFor: async () => {
        calls += 1;
        // The first call is the lane's own width read (cached 60s), not a job's; the second
        // is the first job's, and that is the one this test means to fail.
        if (calls === 2) throw new Error("connection terminated");
        return {
          elevenlabs: {
            modelId: "eleven_v3",
            voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
            seedStrategy: "npc",
          },
          fish: { model: "s2.1-pro", temperature: 0.7, topP: 0.7, speed: 1 },
        };
      },
      budget: async () => 1,
      regenerate: { quests: async () => OK },
    });
    await until(async () => {
      const states = await statesOf(batch);
      return states.failed === 1 && states.done === 1;
    });
    await worker.stop();

    const { rows } = await db().query<{ error: string }>(
      `select "error" from "regeneration_job" where "batchId" = $1 and "state" = 'failed'`,
      [batch],
    );
    expect(rows[0].error).toMatch(/connection terminated/);
  });
});

describe("an ElevenLabs batch", () => {
  it("is spoken with the owner's own ElevenLabs settings", async () => {
    const batch = await seed(1);
    const seen: { provider?: string; seed?: string }[] = [];
    const worker = startWorker(() => true, {
      apiKeyFor: async () => "eleven-key",
      preferenceFor: async () => ({
        elevenlabs: {
          modelId: "eleven_multilingual_v2",
          voiceSettings: { stability: 0.9, similarity_boost: 0.1, style: 0, use_speaker_boost: false },
          seedStrategy: "none",
        },
        fish: { model: "s2.1-pro", temperature: 0.7, topP: 0.7, speed: 1 },
      }),
      budget: async () => 1,
      regenerate: {
        quests: async (_line, _user, options) => {
          seen.push({ provider: options.speaker.provider, seed: options.speaker.seedStrategy });
          return OK;
        },
      },
    });
    await until(async () => (await statesOf(batch)).done === 1);
    await worker.stop();

    expect(seen).toEqual([{ provider: "elevenlabs", seed: "none" }]);
  });
});
