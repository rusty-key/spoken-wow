/**
 * Against a real Postgres, deliberately.
 *
 * What queue.ts is for is a set of exclusions - one job per file at a time, one claimant per
 * job, a lease that expires - and every one of them lives in the schema rather than in the
 * code. A mocked database would assert that the code calls the functions the code calls,
 * which is not a test of any of that.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { ownTeam } from "@/lib/teams/testing";
import { teamOf } from "@/lib/teams/store";

import { activeLanes, cancelPending, dismissThrough, claimNext, createBatch, enqueue, failJob, finishJob, laneKey, pauseQueue, resumeQueue, retryJob, snapshot, type QueueEntry } from "./queue";
import type { Source } from "@/lib/sections";

/** A file prefix no other run collides with, so tests share one database safely. */
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

async function newBatch(source: Source = "quests", createdBy: string | null = null): Promise<string> {
  const id = await createBatch("test batch", createdBy, source);
  batches.push(id);
  return id;
}

beforeEach(() => {
  prefix = `test-${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  // Pauses are global, so the tests pause only koKR, which no other test file queues in.
  await db().query(`delete from "regeneration_pause" where "lang" = 'koKR'`);
  // Cascades to the jobs, so nothing this file wrote outlives it.
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

describe("enqueue", () => {
  it("refuses a second job for a file already queued", async () => {
    const first = await newBatch();
    expect(await enqueue(first, [line(1), line(2)], "quests")).toEqual({ queued: 2, skipped: 0 });

    const second = await newBatch();
    expect(await enqueue(second, [line(2), line(3)], "quests")).toEqual({ queued: 1, skipped: 1 });
  });

  it("accepts a file again once its job has finished", async () => {
    const first = await newBatch();
    await enqueue(first, [line(1)], "quests");
    const claimed = await claimNext();
    await finishJob(claimed!.id, { version: 1, credits: 55 });

    const second = await newBatch();
    expect(await enqueue(second, [line(1)], "quests")).toEqual({ queued: 1, skipped: 0 });
  });

  /**
   * The reason the credit guard is keyed on the source and not the file alone. The two
   * sections name files by their own frozen rules and nothing keeps the namespaces apart, so
   * without this a places job would silently block a quests one -- which reads as "nothing
   * happened when I pressed Regenerate", with nothing anywhere saying why.
   */
  it("does not let one section's queued file block the other's", async () => {
    const quests = await newBatch();
    expect(await enqueue(quests, [line(1)], "quests")).toEqual({ queued: 1, skipped: 0 });

    const places = await newBatch("places");
    expect(await enqueue(places, [line(1)], "places")).toEqual({ queued: 1, skipped: 0 });

    // Still one job per file within a source, which is what the guard is actually for.
    const again = await newBatch("places");
    expect(await enqueue(again, [line(1)], "places")).toEqual({ queued: 0, skipped: 1 });
  });

  it("tells the worker which generator a claimed job wants", async () => {
    const places = await newBatch("places");
    await enqueue(places, [line(7)], "places");

    const claimed = await claimNext();
    expect(claimed!.source).toBe("places");
  });
});

describe("the generator a job is spoken by", () => {
  // A voice pinned to fish.audio queues its lines as fish.audio jobs inside a batch whose
  // collaborator generates with ElevenLabs; the worker reads each job's own.
  it("is the batch's unless the job names its own", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), { ...line(2), provider: "fish" }], "quests", "enUS", "elevenlabs");
    const { rows } = await db().query<{ file: string; provider: string }>(
      `select "file", "provider" from "regeneration_job" where "batchId" = $1 order by "file"`,
      [batch],
    );
    expect(rows).toEqual([
      { file: `${prefix}/1.mp3`, provider: "elevenlabs" },
      { file: `${prefix}/2.mp3`, provider: "fish" },
    ]);
  });
});

describe("the language a job is in", () => {
  it("is English unless the batch says otherwise", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    expect((await claimJobOfThisRun())?.lang).toBe("enUS");
  });

  // A Portuguese take of a file is a different recording from the English one.
  it("keeps the same file in two languages as two jobs", async () => {
    const english = await newBatch();
    const portuguese = await createBatch("test batch", null, "quests", "ptBR");
    batches.push(portuguese);
    expect(await enqueue(english, [line(1)], "quests")).toEqual({ queued: 1, skipped: 0 });
    expect(await enqueue(portuguese, [line(1)], "quests", "ptBR")).toEqual({ queued: 1, skipped: 0 });
    expect(await enqueue(portuguese, [line(1)], "quests", "ptBR")).toEqual({ queued: 0, skipped: 1 });
  });

  // What the worker generates in, and what the snapshot tells a page it may adopt.
  it("rides from the enqueue to the claim", async () => {
    const id = await createBatch("test batch", null, "quests", "ptBR");
    batches.push(id);
    await enqueue(id, [line(1)], "quests", "ptBR");
    expect((await claimJobOfThisRun())?.lang).toBe("ptBR");
  });
});

describe("the owner of a job", () => {
  it("is copied from the batch onto every job, and rides to the claim", async () => {
    const alice = await newUser();
    const batch = await newBatch("quests", alice);
    await enqueue(batch, [line(1), line(2)], "quests");

    const { rows } = await db().query<{ owner: string | null }>(
      `select "owner" from "regeneration_job" where "batchId" = $1`,
      [batch],
    );
    expect(rows).toEqual([{ owner: alice }, { owner: alice }]);
    expect((await claimNext())!.owner).toBe(alice);
  });

  it("is null for a batch nobody owns", async () => {
    const batch = await newBatch("quests", null);
    await enqueue(batch, [line(1)], "quests");

    expect((await claimNext())!.owner).toBeNull();
  });

  /**
   * What an older release's enqueue does: it predates the column and names no owner. That
   * code runs against this schema between a migration and the pm2 reload, and again after a
   * rollback, so the database fills the owner in rather than leaving the job ownerless.
   */
  it("is filled in from the batch when an insert leaves it out", async () => {
    const alice = await newUser();
    const batch = await newBatch("quests", alice);
    await db().query(
      `insert into "regeneration_job"
         ("batchId", "source", "lang", "provider", "lineId", "file", "npcName", "preview", "characters")
       values ($1, 'quests', 'enUS', 'elevenlabs', 'q:1:accept', $2, 'NPC 1', 'line 1', 100)`,
      [batch, `${prefix}/1.mp3`],
    );

    const { rows } = await db().query<{ owner: string | null }>(
      `select "owner" from "regeneration_job" where "batchId" = $1`,
      [batch],
    );
    expect(rows).toEqual([{ owner: alice }]);
  });
});

describe("claimNext", () => {
  it("hands two concurrent callers different jobs", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)], "quests");

    const [a, b] = await Promise.all([claimNext(), claimNext()]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toEqual(b!.id);
  });

  it("returns null when nothing is due", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    await claimNext();

    // The one job is now running and its lease is live, so there is nothing to claim.
    expect(await claimJobOfThisRun()).toBeNull();
  });

  it("reclaims a job whose lease has expired", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    const first = await claimNext(-1000); // a lease that expired a second ago

    const second = await claimNext();
    expect(second!.id).toEqual(first!.id);
    expect(second!.attempts).toEqual(2);
  });

  it("does not claim a job backed off into the future", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    const claimed = await claimNext();
    await retryJob(claimed!.id, 60_000);

    expect(await claimJobOfThisRun()).toBeNull();
  });
});

describe("activeLanes", () => {
  it("ranks owners by their oldest unfinished job and takes the first `max`", async () => {
    const [alice, bob, carol] = [await newUser(), await newUser(), await newUser()];
    await enqueue(await newBatch("quests", alice), [line(1)], "quests");
    await enqueue(await newBatch("quests", bob), [line(2)], "quests");
    await enqueue(await newBatch("quests", carol), [line(3)], "quests");

    expect(await activeLanes(2)).toEqual([
      { owner: alice, provider: "elevenlabs" },
      { owner: bob, provider: "elevenlabs" },
    ]);
  });

  it("gives one owner with both providers two lanes and one place", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    await enqueue(await newBatch("quests", alice), [line(1)], "quests", "enUS", "elevenlabs");
    await enqueue(await newBatch("quests", alice), [line(2)], "quests", "enUS", "fish");
    await enqueue(await newBatch("quests", bob), [line(3)], "quests");

    const lanes = await activeLanes(1);
    expect(lanes.map(laneKey).sort()).toEqual([`${alice}:elevenlabs`, `${alice}:fish`]);
  });

  it("keeps an owner's place while their older work lasts, then ranks the rest by its own ids", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    await enqueue(await newBatch("quests", alice), [line(1)], "quests");
    await enqueue(await newBatch("quests", bob), [line(2)], "quests");
    // Alice queues more while her first batch is still unfinished.
    await enqueue(await newBatch("quests", alice), [line(3)], "quests");

    expect((await activeLanes(1))[0].owner).toBe(alice);

    const first = await claimNext(undefined, { owner: alice, provider: "elevenlabs" });
    expect(first!.file).toBe(`${prefix}/1.mp3`);
    await finishJob(first!.id, { version: 1, credits: 1 });

    // Her remaining job is newer than Bob's, so Bob, who was waiting, goes first.
    expect((await activeLanes(1))[0].owner).toBe(bob);
  });

  it("keeps the place of an owner whose job is backing off", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    await enqueue(await newBatch("quests", alice), [line(1)], "quests");
    await enqueue(await newBatch("quests", bob), [line(2)], "quests");
    const claimed = await claimNext(undefined, { owner: alice, provider: "elevenlabs" });
    await retryJob(claimed!.id, 60_000);

    expect((await activeLanes(1))[0].owner).toBe(alice);
  });

  it("treats jobs nobody owns as one queue", async () => {
    await enqueue(await newBatch("quests", null), [line(1)], "quests");
    await enqueue(await newBatch("quests", null), [line(2)], "quests");

    expect(await activeLanes(5)).toEqual([{ owner: null, provider: "elevenlabs" }]);
  });
});

describe("claimNext within a lane", () => {
  it("claims only that lane's jobs, even when another's are older", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    await enqueue(await newBatch("quests", alice), [line(1)], "quests");
    await enqueue(await newBatch("quests", bob), [line(2)], "quests");

    const job = await claimNext(undefined, { owner: bob, provider: "elevenlabs" });
    expect(job!.owner).toBe(bob);
    expect(await claimNext(undefined, { owner: bob, provider: "fish" })).toBeNull();
  });

  it("claims in the lane of jobs nobody owns", async () => {
    await enqueue(await newBatch("quests", null), [line(1)], "quests");

    expect(await claimNext(undefined, { owner: null, provider: "elevenlabs" })).not.toBeNull();
  });

  it("reclaims an expired lease in its own lane and not in another", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    await enqueue(await newBatch("quests", alice), [line(1)], "quests");
    const aliceLane = { owner: alice, provider: "elevenlabs" as const };
    const first = await claimNext(-1000, aliceLane); // a lease that expired a second ago

    expect(await claimNext(undefined, { owner: bob, provider: "elevenlabs" })).toBeNull();
    const again = await claimNext(undefined, aliceLane);
    expect(again!.id).toBe(first!.id);
    expect(again!.attempts).toBe(2);
  });
});

describe("pausing", () => {
  it("claims nothing in a paused language until it is resumed", async () => {
    const batch = await createBatch("test batch", null, "quests", "koKR");
    batches.push(batch);
    await enqueue(batch, [line(1)], "quests", "koKR");

    await pauseQueue(["koKR"], null);
    expect(await claimJobOfThisRun()).toBeNull();

    await resumeQueue(["koKR"], null);
    expect(await claimJobOfThisRun()).not.toBeNull();
  });

  it("does not reclaim an expired lease in a paused language", async () => {
    // A reclaim is a fresh attempt, and a fresh attempt is new spending.
    const batch = await createBatch("test batch", null, "quests", "koKR");
    batches.push(batch);
    await enqueue(batch, [line(1)], "quests", "koKR");
    await claimNext(-1000); // a lease that expired a second ago

    await pauseQueue(["koKR"], null);
    expect(await claimJobOfThisRun()).toBeNull();
  });

  it("leaves other languages running", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");

    await pauseQueue(["koKR"], null);
    expect(await claimJobOfThisRun()).not.toBeNull();
  });

  it("gives a paused queue's place to the next one", async () => {
    const [alice, bob] = [await newUser(), await newUser()];
    const paused = await createBatch("test batch", alice, "quests", "koKR");
    batches.push(paused);
    await enqueue(paused, [line(1)], "quests", "koKR");
    await enqueue(await newBatch("quests", bob), [line(2)], "quests");

    await pauseQueue(["koKR"], null);
    expect((await activeLanes(1)).map((lane) => lane.owner)).toEqual([bob]);

    await resumeQueue(["koKR"], null);
    expect((await activeLanes(1)).map((lane) => lane.owner)).toEqual([alice]);
  });

  it("answers with the languages it changed, so a second press changes nothing", async () => {
    expect(await pauseQueue(["koKR"], null)).toEqual(["koKR"]);
    expect(await pauseQueue(["koKR"], null)).toEqual([]);
    expect(await resumeQueue(["koKR"], null)).toEqual(["koKR"]);
    expect(await resumeQueue(["koKR"], null)).toEqual([]);
  });

  it("shows the pause, and the paused queue as paused rather than waiting", async () => {
    const alice = await newUser();
    const batch = await createBatch("test batch", alice, "quests", "koKR");
    batches.push(batch);
    await enqueue(batch, [line(1)], "quests", "koKR");

    await pauseQueue(["koKR"], alice);
    const seen = await snapshot(null, { maxActive: 1 });

    expect(seen.paused).toContainEqual(
      expect.objectContaining({ lang: "koKR", by: `Owner ${alice}` }),
    );
    expect(seen.queues.find((queue) => queue.owner === alice)).toMatchObject({
      status: "paused",
      pending: 1,
      ahead: 0,
    });
  });
});

describe("cancelPending", () => {
  it("cancels pending jobs and spares running ones", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2), line(3)], "quests");
    const running = await claimNext();

    expect(await cancelPending("stopped by hand", { batchId: batch })).toEqual(2);

    const states = await stateCounts(batch);
    expect(states).toEqual({ running: 1, cancelled: 2 });
    expect(running).not.toBeNull();

    const { rows } = await db().query(
      `select "kind", "actorId", "detail" from "activity" where "subject" = $1`,
      [batch],
    );
    expect(rows).toEqual([
      {
        kind: "batch.stopped",
        actorId: null,
        detail: { batchId: batch, label: expect.any(String), reason: "stopped by hand", cancelled: 2 },
      },
    ]);
  });

  it("leaves other batches alone when given a batch id", async () => {
    const mine = await newBatch();
    await enqueue(mine, [line(1)], "quests");
    const theirs = await newBatch();
    await enqueue(theirs, [line(2)], "quests");

    await cancelPending("stopped", { batchId: mine });

    expect(await stateCounts(theirs)).toEqual({ pending: 1 });
  });

  it("stops only the languages it is given, and stamps only their batches", async () => {
    const english = await newBatch();
    await enqueue(english, [line(1)], "quests");
    const portuguese = await createBatch("test batch", null, "quests", "ptBR");
    batches.push(portuguese);
    await enqueue(portuguese, [line(1)], "quests", "ptBR");

    expect(await cancelPending("Stopped by a translator", { langs: ["ptBR"] })).toBeGreaterThanOrEqual(1);

    expect(await stateCounts(english)).toEqual({ pending: 1 });
    expect(await stateCounts(portuguese)).toEqual({ cancelled: 1 });
    const { rows } = await db().query<{ id: string; stopped: boolean }>(
      `select "id", "stoppedAt" is not null as stopped from "regeneration_batch"
        where "id" = any($1)`,
      [[english, portuguese]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.stopped]))).toEqual({
      [english]: false,
      [portuguese]: true,
    });
  });

  it("logs one Stop of several batches as one row, with the batches grouped under it", async () => {
    const first = await createBatch("first", null, "quests", "koKR");
    const second = await createBatch("second", null, "quests", "koKR");
    batches.push(first, second);
    await enqueue(first, [line(1)], "quests", "koKR");
    await enqueue(second, [line(2), line(3)], "quests", "koKR");

    await cancelPending("Stopped by Ana", { langs: ["koKR"] });

    const { rows } = await db().query<{ kind: string; subject: string | null; detail: Record<string, unknown> }>(
      `select "kind", "subject", "detail" from "activity"
        where "subject" = any($1)
           or ("kind" = 'queue.stopped' and "detail"->>'groupId' in
                 (select "detail"->>'groupId' from "activity" where "subject" = any($1)))`,
      [[first, second]],
    );
    const press = rows.find((row) => row.kind === "queue.stopped");
    expect(press?.detail).toEqual({
      groupId: expect.any(String),
      batches: 2,
      cancelled: 3,
      reason: "Stopped by Ana",
    });
    expect(
      rows
        .filter((row) => row.kind === "batch.stopped")
        .map((row) => [row.subject, row.detail.groupId, row.detail.cancelled])
        .sort(),
    ).toEqual(
      [
        [first, press?.detail.groupId, 1],
        [second, press?.detail.groupId, 2],
      ].sort(),
    );
    await db().query(`delete from "activity" where "detail"->>'groupId' = $1`, [press?.detail.groupId]);
  });
});

describe("snapshot", () => {
  it("sums real credits and counts unpriced takes separately", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)], "quests");
    const a = await claimNext();
    await finishJob(a!.id, { version: 1, credits: 55 });
    const b = await claimNext();
    await finishJob(b!.id, { version: 1, credits: null });

    const seen = await snapshot(null);
    expect(seen.credits).toBeGreaterThanOrEqual(55);
    expect(seen.unpriced).toBeGreaterThanOrEqual(1);
  });

  it("sums fish.audio's dollars apart from credits, and counts them as priced", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    const before = await snapshot(null);
    const a = await claimNext();
    await finishJob(a!.id, { version: 1, credits: null, costUsd: 0.0042 });

    const seen = await snapshot(null);
    expect(seen.costUsd - before.costUsd).toBeCloseTo(0.0042);
    expect(seen.credits).toBe(before.credits);
    expect(seen.unpriced).toBe(before.unpriced);
  });

  it("reports jobs finished after the cursor, and not before it", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)], "quests");

    const a = await claimNext();
    await finishJob(a!.id, { version: 3, credits: 55 });
    const afterFirst = await snapshot(null);
    expect(afterFirst.finished.map((job) => job.id)).toContain(a!.id);

    const b = await claimNext();
    await finishJob(b!.id, { version: 4, credits: 55 });
    const afterSecond = await snapshot(afterFirst.cursor);
    const ids = afterSecond.finished.map((job) => job.id);

    expect(ids).toContain(b!.id);
    expect(ids).not.toContain(a!.id);
    expect(afterSecond.finished.find((job) => job.id === b!.id)).toMatchObject({
      file: line(2).file,
      version: 4,
    });
  });

  it("sees a job old enough to have fallen out of the window, because claimNext still can", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    // The queue starts lazily, so a batch interrupted by a deploy really can sit for days.
    // A snapshot that aged it out would render no panel at all - and therefore no Stop -
    // over a queue that is about to spend money.
    await db().query(
      `update "regeneration_job" set "queuedAt" = now() - interval '3 days' where "batchId" = $1`,
      [batch],
    );

    const seen = await snapshot(null);
    expect(seen.active).toBe(true);
    expect(seen.counts.pending).toBeGreaterThanOrEqual(1);
    expect(await claimNext()).not.toBeNull();
  });

  it("does not hang a stopped batch's reason on the next batch to run cleanly", async () => {
    const stoppedBatch = await newBatch();
    await enqueue(stoppedBatch, [line(1)], "quests");
    await cancelPending("Stopped by an admin", { batchId: stoppedBatch });
    expect((await snapshot(null)).latestBatch).toMatchObject({
      cancelled: 1,
      stoppedBecause: "Stopped by an admin",
    });

    const cleanBatch = await newBatch();
    await enqueue(cleanBatch, [line(2)], "quests");
    const job = await claimNext();
    await finishJob(job!.id, { version: 1, credits: 55 });

    expect((await snapshot(null)).latestBatch).toEqual({
      cancelled: 0,
      stoppedBecause: null,
    });
  });

  it("lists only one owner's running lines and failures when asked, but everyone's queue", async () => {
    const alice = await newUser();
    const bob = await newUser();
    await enqueue(await newBatch("quests", alice), [line(1), line(2)], "quests");
    await enqueue(await newBatch("quests", bob), [line(3), line(4)], "quests");

    const aliceLane = { owner: alice, provider: "elevenlabs" as const };
    const bobLane = { owner: bob, provider: "elevenlabs" as const };
    await claimNext(undefined, aliceLane);
    await claimNext(undefined, bobLane);
    await failJob((await claimNext(undefined, aliceLane))!.id, { kind: "test", message: `${prefix} alice` });
    await failJob((await claimNext(undefined, bobLane))!.id, { kind: "test", message: `${prefix} bob` });

    const mine = (seen: Awaited<ReturnType<typeof snapshot>>) => ({
      running: seen.running.map((job) => job.preview),
      failures: seen.failures.filter((job) => job.message.startsWith(prefix)).map((job) => job.message),
    });

    const own = await snapshot(null, { viewerId: alice, linesOf: alice });
    expect(mine(own)).toEqual({ running: ["line 1"], failures: [`${prefix} alice`] });
    expect(own.queues.map((queue) => queue.owner)).toEqual(expect.arrayContaining([alice, bob]));

    const all = mine(await snapshot(null, { viewerId: alice }));
    expect(all.running).toEqual(expect.arrayContaining(["line 1", "line 3"]));
    expect(all.failures).toEqual(expect.arrayContaining([`${prefix} alice`, `${prefix} bob`]));
  });

  it("answers one poll with two pooled connections, not seven", async () => {
    // The exact count that matters: a batch in flight already holds two connections per job,
    // so the number a poll opens on top of that is the tightest budget in the system. This
    // spies on the real pool rather than mocking it - every query below still runs against
    // Postgres, only the call count is observed.
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");

    const pool = db();
    // Connections rather than pool.query calls: each query runs in its own team transaction.
    const original = pool.connect.bind(pool);
    let calls = 0;
    const spy = vi
      .spyOn(pool, "connect")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((...args: any[]) => {
        calls++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any)(...args);
      });

    try {
      await snapshot(null);
    } finally {
      spy.mockRestore();
    }

    expect(calls).toBe(2);
  });

  it("carries a failure's message rather than just a count", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    const job = await claimNext();
    await failJob(job!.id, { kind: "bad-request", message: "no line q:1:accept" });

    const seen = await snapshot(null);
    expect(seen.failures).toContainEqual({
      source: "quests",
      lang: "enUS",
      lineId: "q:1:accept",
      message: "no line q:1:accept",
    });
  });

  it("lists each owner's queue, active or waiting, in the order they drain", async () => {
    const owners = [await newUser(), await newUser(), await newUser(), await newUser()];
    for (const [i, owner] of owners.entries()) {
      await enqueue(await newBatch("quests", owner), [line(i * 10 + 1), line(i * 10 + 2)], "quests");
    }

    const { queues } = await snapshot(null, { viewerId: owners[3], maxActive: 3 });

    expect(queues.map((queue) => queue.owner)).toEqual(owners);
    expect(queues.map((queue) => [queue.status, queue.ahead])).toEqual([
      ["active", 0],
      ["active", 0],
      ["active", 0],
      ["waiting", 3],
    ]);
    expect(queues.map((queue) => queue.mine)).toEqual([false, false, false, true]);
    expect(queues[0]).toMatchObject({ name: `Owner ${owners[0]}`, pending: 2, running: 0 });
  });

  it("names a queue whose owner is gone, and keeps it one queue", async () => {
    const gone = await newUser();
    await enqueue(await newBatch("quests", gone), [line(1), line(2)], "quests");
    await db().query(`delete from "user" where "id" = $1`, [gone]);
    await enqueue(await newBatch("quests", null), [line(3)], "quests");

    const { queues } = await snapshot(null);

    expect(queues).toHaveLength(2);
    expect(queues[0]).toMatchObject({ owner: gone, name: "Deleted account", pending: 2 });
    expect(queues[1]).toMatchObject({ owner: null, name: "Deleted account", pending: 1 });
  });
});

/** Claim, but only accept a job this test run created. Other suites share the database. */
async function claimJobOfThisRun() {
  const job = await claimNext();
  return job && job.file.startsWith(prefix) ? job : null;
}

async function stateCounts(batchId: string): Promise<Record<string, number>> {
  const { rows } = await db().query<{ state: string; n: string }>(
    `select "state", count(*)::text as n from "regeneration_job"
      where "batchId" = $1 group by "state"`,
    [batchId],
  );
  return Object.fromEntries(rows.map((row) => [row.state, Number(row.n)]));
}

describe("a language's team", () => {
  let german: Awaited<ReturnType<typeof ownTeam>>;

  beforeEach(async () => {
    german = await ownTeam("deDE");
  });

  afterEach(async () => {
    await db().query(`delete from "regeneration_pause" where "lang" = 'deDE'`);
    await db().query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [batches]);
    batches.length = 0;
    await german.restore();
  });

  async function germanJob(n: number) {
    const batch = await createBatch("test batch", null, "quests", "deDE");
    batches.push(batch);
    await enqueue(batch, [line(n)], "quests", "deDE");
    return batch;
  }

  it("is stamped on the batch and its jobs, and rides to the claim", async () => {
    const batch = await germanJob(1);
    const { rows } = await db().query(
      `select b."teamId" as "batch", j."teamId" as "job"
         from "regeneration_batch" b join "regeneration_job" j on j."batchId" = b."id"
        where b."id" = $1`,
      [batch],
    );
    expect(rows).toEqual([{ batch: german.team, job: german.team }]);

    const claimed = await claimJobOfThisRun();
    expect(claimed?.teamId).toBe(german.team);
  });

  it("is the english team's for an English job", async () => {
    await enqueue(await newBatch(), [line(2)], "quests");
    expect((await claimJobOfThisRun())?.teamId).toBe(await teamOf("enUS"));
  });

  it("is what a pause is held under, holding back that language's jobs only", async () => {
    await germanJob(1);
    await enqueue(await newBatch(), [line(2)], "quests");

    expect(await pauseQueue(["deDE"], null)).toEqual(["deDE"]);
    const { rows } = await db().query(`select "teamId" from "regeneration_pause" where "lang" = 'deDE'`);
    expect(rows).toEqual([{ teamId: german.team }]);

    expect((await claimJobOfThisRun())?.lang).toBe("enUS");
    expect(await claimJobOfThisRun()).toBeNull();

    expect(await resumeQueue(["deDE"], null)).toEqual(["deDE"]);
    expect((await claimJobOfThisRun())?.lang).toBe("deDE");
  });

  it("does not let a pause held by another team hold this one's work", async () => {
    // Two teams in one language arrive in a later phase; the pause must already be theirs.
    await germanJob(1);
    await db().query(
      `insert into "regeneration_pause" ("lang", "teamId") values ('deDE', $1)`,
      [await teamOf("enUS")],
    );
    expect((await claimJobOfThisRun())?.lang).toBe("deDE");
  });

  it("is what a Stop in that language runs under", async () => {
    const batch = await germanJob(1);
    expect(await cancelPending("stopped", { langs: ["deDE"] })).toBe(1);
    expect(await stateCounts(batch)).toEqual({ cancelled: 1 });
  });
});

describe("dismissing finished work", () => {
  it("hides what was dismissed and keeps what came after", async () => {
    const batch = await createBatch("dismiss", null, "quests");
    batches.push(batch);
    await enqueue(batch, [line(1)], "quests");

    const first = await claimNext();
    await finishJob(first!.id, { version: 1, credits: 10 });

    const before = await snapshot(null);
    expect(before.counts.done).toBeGreaterThan(0);

    await dismissThrough(before.through!, null, "enUS");

    const after = await snapshot(null);
    expect(after.counts.done).toBe(0);
    expect(after.credits).toBe(0);

    // Work that finishes after the dismissal is news again.
    await enqueue(batch, [line(2)], "quests");
    const second = await claimNext();
    await finishJob(second!.id, { version: 1, credits: 10 });

    expect((await snapshot(null)).counts.done).toBe(1);
  });

  it("hides a stopped run's cancelled jobs along with its finished ones", async () => {
    const batch = await createBatch("dismiss-stopped", null, "quests");
    batches.push(batch);
    await enqueue(batch, [line(5), line(6)], "quests");

    const done = await claimNext();
    await finishJob(done!.id, { version: 1, credits: 10 });
    await cancelPending("stopped", { batchId: batch });

    // The cancelled job has the higher id, so a watermark that only counted done and failed
    // jobs would leave it - and the whole panel - standing after the X.
    const before = await snapshot(null);
    expect(before.counts.cancelled).toBe(1);

    await dismissThrough(before.through!, null, "enUS");
    const after = await snapshot(null);

    expect(after.counts).toEqual({ pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 });
    expect(after.through).toBeNull();
  });

  it("never hides work that is still running or pending", async () => {
    const batch = await createBatch("dismiss-live", null, "quests");
    batches.push(batch);
    await enqueue(batch, [line(3)], "quests");

    const done = await claimNext();
    await finishJob(done!.id, { version: 1, credits: 10 });
    await enqueue(batch, [line(4)], "quests");

    // Dismissing the finished job must leave the pending one - and the Stop button - alone.
    await dismissThrough((await snapshot(null)).through!, null, "enUS");
    const after = await snapshot(null);

    expect(after.counts.pending + after.counts.running).toBe(1);
    expect(after.active).toBe(true);
  });
});
