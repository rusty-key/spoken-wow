/**
 * Every SQL statement the regeneration queue needs, and nothing else.
 *
 * No ElevenLabs, no leadership, no timers: this module is the store, and it is the only one
 * that knows the column names. worker.ts decides what to do; this decides what is written.
 *
 * Rows are keyed on the file for the reason migration 0013 records - a job is one mp3, not
 * one line - and the exclusions that keep the queue honest live in the schema, not here.
 *
 * ONE QUEUE FOR BOTH SECTIONS. There is one ElevenLabs plan behind it, the panel shows what
 * everyone is spending, and two queues would need a scheduler between them to decide which
 * is allowed to run. The source rides on each job and decides which generator worker.ts
 * hands it to; it is also half the credit guard's key, because the two sides name files by
 * their own frozen rules and a collision would mean one section's job silently blocking the
 * other's - which reads as "nothing happened when I pressed Regenerate".
 *
 * THE LANGUAGE RIDES ON EACH JOB TOO, and is the guard's third term for the same reason: a
 * Portuguese take of a file is a different recording from the English one, and queueing both
 * is two jobs rather than a duplicate. It is what the generator is asked to speak in.
 */
import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { recordActivities, type ActivityEvent } from "@/lib/activity/store";
import { db, inTransaction } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";
import { maxActiveFrom } from "./concurrency";
import type { QueueLine } from "./queue-line";
import type { Provider } from "./speakers/speaker";

export type JobState = "pending" | "running" | "done" | "failed" | "cancelled";


/**
 * One unit of work, in terms both sections can express.
 *
 * npcName and preview are denormalised from whatever corpus this came from, so that polling
 * every two seconds - and the worker itself - never need to load one. The places side has no
 * NPC and puts the zone's name there; what the column is for is a label the panel can show.
 */
export type QueueEntry = {
  lineId: string;
  file: string;
  npcName: string;
  preview: string;
  characters: number;
  /** The batch's provider when absent: only a voice pinned to fish.audio overrides it. */
  provider?: Provider;
};

/** A claimed job, with the batch's owner joined in so the take records who paid for it. */
export type QueueJob = {
  /** bigserial, which `pg` returns as a string. Kept as one so nothing rounds it. */
  id: string;
  batchId: string;
  source: Source;
  lang: Lang;
  lineId: string;
  file: string;
  npcName: string;
  preview: string;
  characters: number;
  attempts: number;
  createdBy: string | null;
  /** Fixed when the job was queued: the provider its estimate was shown for. */
  provider: Provider;
  /**
   * Whose queue the job is in: the batch's owner, copied onto the job when it was queued.
   * Unlike `createdBy` it survives the owner's account being deleted, which keeps their
   * remaining jobs together as one queue.
   */
  owner: string | null;
};

/**
 * One owner's work for one provider.
 *
 * The unit the worker sizes and cools down, because it is exactly one API key: every job is
 * spent from its owner's own key for the provider it was queued with. An owner with batches
 * on both providers has two lanes and still one queue.
 */
export type Lane = { owner: string | null; provider: Provider };

/** A lane as a map key. The empty string stands for jobs nobody owns any more. */
export function laneKey(lane: Lane): string {
  return `${lane.owner ?? ""}:${lane.provider}`;
}

export type QueueSnapshot = {
  /** Whether anything is pending or running, which is what drives the poll interval. */
  active: boolean;
  counts: Record<JobState, number>;
  /** Summed from what ElevenLabs charged, never from the estimate. */
  credits: number;
  /** Summed from what fish.audio jobs cost, in dollars; never added to `credits`. */
  costUsd: number;
  /** Takes neither provider priced, counted rather than assumed to be free. */
  unpriced: number;
  running: { source: Source; lang: Lang; lineId: string; npcName: string; preview: string }[];
  failures: { source: Source; lang: Lang; lineId: string; message: string }[];
  /**
   * The newest batch's own stop, or null when there is no batch at all.
   *
   * Scoped to that one batch while the counts above stay global, because "Stopped" and the
   * reason under it are claims about a particular batch: read from the whole window they
   * would put yesterday's stop reason on today's clean run.
   */
  latestBatch: { cancelled: number; stoppedBecause: string | null } | null;
  /**
   * The languages paused now, whoever paused them. Global like the counts: a queue that has
   * stopped moving should say why, even to someone who cannot resume it.
   */
  paused: { lang: Lang; pausedAt: string; by: string | null }[];
  /**
   * Each owner's queue, in the order they drain: the first QUEUE_MAX_ACTIVE are active, the
   * rest wait. Ranked exactly as activeLanes ranks them, so the panel says what the worker does.
   */
  queues: QueueLine[];
  /**
   * Jobs that reached `done` after the cursor, for the page to adopt.
   *
   * Carries the source because two explorers poll the same queue, and each may only adopt
   * its own: a quests page told that '1411/razor-hill' is now at version 3 would look for a
   * line it does not have. The language for the same reason one level down: an English page
   * adopting a Portuguese version number would point its player at a take it cannot play.
   */
  finished: { id: string; source: Source; lang: Lang; lineId: string; file: string; version: number }[];
  /** Pass back as `since` on the next poll. */
  cursor: string;
  /**
   * The newest job the counts include that can no longer change, or null when there is none:
   * what the panel's X hands to dismissThrough.
   *
   * Not the cursor. The cursor skips cancelled jobs, which have no take to adopt, and stops
   * at a page boundary when a run finished more lines than one poll carries - so dismissing
   * through it left a stopped run's cancellations, or most of a long run, on screen.
   */
  through: string | null;
};

export const DEFAULT_LEASE_MS = 5 * 60_000;

/**
 * How long a *finished* batch stays in the snapshot after it drains.
 *
 * The panel has to keep saying "Finished" after the last job lands, so the window cannot be
 * "has unfinished work". A day is long enough that nobody loses a result they were watching
 * and short enough that the query stays small.
 *
 * It applies only to terminal rows. Pending and running jobs are counted however old they
 * are, because claimNext has no window: it will claim and pay for a job queued a week ago,
 * and a snapshot that could not see it would render no panel at all - no progress, no credit
 * total and, worst of all, no Stop button for a queue that is spending money.
 */
const WINDOW = "24 hours";

/** Batches older than this are deleted outright, jobs cascading with them. */
const RETENTION = "30 days";

/** How many finished jobs one poll carries. Enough that a tab which slept catches up fast. */
const FINISHED_PAGE = 500;

type Queryable = Pick<PoolClient, "query">;

async function insertBatch(
  on: Queryable,
  label: string,
  createdBy: string | null,
  source: Source,
  lang: Lang,
): Promise<string> {
  const { rows } = await on.query<{ id: string }>(
    `insert into "regeneration_batch" ("label", "createdBy", "source", "lang")
     values ($1, $2, $3, $4) returning "id"`,
    [label, createdBy, source, lang],
  );
  return rows[0].id;
}

export async function createBatch(
  label: string,
  createdBy: string | null,
  source: Source,
  lang: Lang = BASE_LANG,
): Promise<string> {
  return insertBatch(db(), label, createdBy, source, lang);
}

// Old batches are pruned when jobs are added rather than on a schedule, because that is the
// only path that grows the table and there is no cron on the droplet.
async function pruneOldBatches(): Promise<void> {
  await db().query(
    `delete from "regeneration_batch" where "createdAt" < now() - interval '${RETENTION}'`,
  );
}

/**
 * Add jobs, refusing any file already queued.
 *
 * ON CONFLICT against regeneration_job_one_per_lang_file, so two overlapping searches cannot
 * pay for the same mp3 in the same language twice. The count of refusals is returned rather than swallowed: "4,000
 * queued, 900 already queued" is the honest answer, and hiding it would make the panel's
 * totals disagree with what was asked for.
 */
export async function enqueue(
  batchId: string,
  jobs: QueueEntry[],
  source: Source,
  lang: Lang = BASE_LANG,
  provider: Provider = "elevenlabs",
): Promise<{ queued: number; skipped: number }> {
  if (jobs.length === 0) return { queued: 0, skipped: 0 };
  await pruneOldBatches();
  return insertJobs(db(), batchId, jobs, source, lang, provider);
}

/**
 * A new batch and its jobs, kept only if at least one job landed: a batch whose every line was
 * already queued would be an empty row that Stop and the panel then have to reason about.
 */
export async function queueBatch(
  label: string,
  createdBy: string | null,
  source: Source,
  lang: Lang,
  jobs: QueueEntry[],
  provider: Provider,
): Promise<{ batchId: string | null; queued: number; skipped: number }> {
  if (jobs.length === 0) return { batchId: null, queued: 0, skipped: 0 };
  await pruneOldBatches();
  return inTransaction(async (client) => {
    const batchId = await insertBatch(client, label, createdBy, source, lang);
    const counts = await insertJobs(client, batchId, jobs, source, lang, provider);
    if (counts.queued > 0) return { batchId, ...counts };
    await client.query(`delete from "regeneration_batch" where "id" = $1`, [batchId]);
    return { batchId: null, ...counts };
  });
}

async function insertJobs(
  on: Queryable,
  batchId: string,
  jobs: QueueEntry[],
  source: Source,
  lang: Lang,
  provider: Provider,
): Promise<{ queued: number; skipped: number }> {
  const { rowCount } = await on.query(
    `insert into "regeneration_job"
       ("batchId", "source", "lang", "provider", "owner", "lineId", "file", "npcName", "preview", "characters")
     select $1, $2, $8, "provider",
            (select "createdBy" from "regeneration_batch" where "id" = $1),
            "lineId", "file", "npcName", "preview", "characters"
       from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $9::text[])
         as job ("lineId", "file", "npcName", "preview", "characters", "provider")
     on conflict ("source", "lang", "file") where "state" in ('pending', 'running') do nothing`,
    [
      batchId,
      source,
      jobs.map((job) => job.lineId),
      jobs.map((job) => job.file),
      jobs.map((job) => job.npcName),
      jobs.map((job) => job.preview),
      jobs.map((job) => job.characters),
      lang,
      jobs.map((job) => job.provider ?? provider),
    ],
  );

  const queued = rowCount ?? 0;
  return { queued, skipped: jobs.length - queued };
}

/**
 * The lanes of the queues allowed to drain now: the first `max` owners, ranked by their oldest
 * unfinished job.
 *
 * Derived from the rows rather than stored, so it needs no upkeep and survives a deploy or a
 * leader handover as it stands. It is sticky by construction: while an owner has any
 * unfinished job, their oldest one is older than anything queued after them, so a queue that
 * started keeps its place until its older work is done. A job backing off after a 429 is still
 * pending, so it keeps its owner's place too.
 *
 * Work in a paused language is left out of the ranking, so a paused queue gives its place to
 * the next one instead of holding a slot it will not use, and takes it back on Resume if its
 * oldest job is still older than everyone else's.
 */
export async function activeLanes(max: number): Promise<Lane[]> {
  // One grouped pass over the lane index rather than a self-join on the owner: the join had
  // to match a null owner to a null owner with `is not distinct from`, which no index serves.
  // Each lane carries its owner's oldest job as `first`, and dense_rank over it gives both
  // lanes of one owner the same place, so `rank <= $1` keeps the first `max` owners whole.
  const { rows } = await db().query<Lane>(
    `with lanes as (
       select "owner", "provider", min(min("id")) over (partition by "owner") as first
         from "regeneration_job"
        where "state" in ('pending', 'running')
          and "lang" not in (select "lang" from "regeneration_pause")
          -- An author who generates on their own machine drains their own lanes.
          and not exists (select 1 from "generation_mode" m
                           where m."userId" = "owner" and m."provider" = "regeneration_job"."provider"
                             and m."mode" = 'local')
        group by "owner", "provider"
     ),
     ranked as (
       select "owner", "provider", first, dense_rank() over (order by first) as rank
         from lanes
     )
     select "owner", "provider" from ranked
      where rank <= $1
      order by first, "provider"`,
    [max],
  );
  return rows;
}

/** Expects `regeneration_job` aliased as `j`. */
const JOB_COLUMNS = `j."id"::text, j."batchId", j."source", j."lang", j."lineId", j."file", j."npcName",
  j."preview", j."characters", j."attempts", j."provider", j."owner",
  (select b."createdBy" from "regeneration_batch" b where b."id" = j."batchId") as "createdBy"`;

/** Expects `regeneration_job` aliased as `r`. */
const DUE = `(("state" = 'pending' and "notBefore" <= now())
            or ("state" = 'running' and "leaseUntil" < now()))
           and "lang" not in (select "lang" from "regeneration_pause")
           and not exists (select 1 from "regeneration_batch" b
                            where b."id" = r."batchId" and b."stoppedAt" is not null)`;

/**
 * Running rows of stopped batches whose lease lapsed: DUE never reclaims them, so a worker that
 * died after Stop would leave its row running, and its file under the credit guard, for good.
 * Each claim cancels them beside itself.
 */
const LAPSED_AFTER_STOP = `update "regeneration_job" l
     set "state" = 'cancelled', "finishedAt" = now(), "leaseUntil" = null, "relay" = null
   where l."state" = 'running' and l."leaseUntil" < now()
     and exists (select 1 from "regeneration_batch" b
                  where b."id" = l."batchId" and b."stoppedAt" is not null)`;

/**
 * Take the next due job, or null. Within one lane when given one.
 *
 * One statement, because dequeuing and reclaiming an abandoned job are the same operation
 * seen from two sides. SKIP LOCKED is not strictly required under a single leader, but it
 * costs nothing and it is what keeps this correct during the seconds when a heartbeat has
 * stood one process down and another has not yet stood up.
 *
 * The lane is optional so that "anything due" stays expressible; the worker always passes one.
 *
 * Nothing in a paused language is due, an expired lease included: reclaiming one is a fresh
 * attempt, and a fresh attempt is the spending the pause was pressed to hold back. Nothing in
 * a stopped batch is due either, for the same reason.
 *
 * A negative `leaseMs` is how the tests produce an already-expired lease.
 */
export async function claimNext(
  leaseMs: number = DEFAULT_LEASE_MS,
  lane?: Lane,
): Promise<QueueJob | null> {
  // Spelled out per case rather than `"owner" is not distinct from $2`, which reads the same
  // but cannot use regeneration_job_lane: Postgres only matches an index on `=` or `is null`,
  // and would walk the primary key filtering every row instead.
  let inLane = "";
  const params: unknown[] = [leaseMs / 1000];
  if (lane && lane.owner === null) {
    inLane = `and "owner" is null and "provider" = $2`;
    params.push(lane.provider);
  } else if (lane) {
    inLane = `and "owner" = $2 and "provider" = $3`;
    params.push(lane.owner, lane.provider);
  }
  const { rows } = await db().query<QueueJob>(
    `with swept as (${LAPSED_AFTER_STOP})
     update "regeneration_job" as j set
        "state"      = 'running',
        "attempts"   = j."attempts" + 1,
        "leaseUntil" = now() + make_interval(secs => $1),
        "startedAt"  = coalesce(j."startedAt", now())
      where j."id" = (
        select "id" from "regeneration_job" r
         where ${DUE}
           ${inLane}
         order by "id"
         for update skip locked
         limit 1
      )
      returning ${JOB_COLUMNS}`,
    params,
  );
  return rows[0] ?? null;
}

/**
 * A lapsed lease is reclaimed as a new attempt, so matching the attempt keeps a slow worker
 * from settling a job someone else now holds. Without one any claim may settle it, which
 * tests that build rows by hand rely on.
 */
function claimed(attempt: number | undefined, at: number): string {
  return attempt === undefined ? "" : `and "state" = 'running' and "attempts" = $${at}`;
}

/** False when the claim has been overtaken. */
export async function finishJob(
  id: string,
  result: { version: number; credits: number | null; costUsd?: number | null },
  attempt?: number,
): Promise<boolean> {
  const params: unknown[] = [id, result.version, result.credits, result.costUsd ?? null];
  if (attempt !== undefined) params.push(attempt);
  const { rowCount } = await db().query(
    `update "regeneration_job"
        set "state" = 'done', "version" = $2, "credits" = $3, "costUsd" = $4,
            "finishedAt" = now(), "leaseUntil" = null, "relay" = null
      where "id" = $1 ${claimed(attempt, 5)}`,
    params,
  );
  return (rowCount ?? 0) > 0;
}

export async function failJob(
  id: string,
  failure: { kind: string; message: string },
  attempt?: number,
): Promise<boolean> {
  const params: unknown[] = [id, failure.kind, failure.message];
  if (attempt !== undefined) params.push(attempt);
  const { rowCount } = await db().query(
    `update "regeneration_job"
        set "state" = 'failed', "errorKind" = $2, "error" = $3,
            "finishedAt" = now(), "leaseUntil" = null, "relay" = null
      where "id" = $1 ${claimed(attempt, 4)}`,
    params,
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Back to pending after `delayMs`, unless the batch was stopped: a pending row would be claimed
 * and paid for after Stop, so it fails with `because` instead, or is cancelled when there is no
 * failure to report. The batch row is share-locked so a Stop running meanwhile either waits for
 * this or is seen by it.
 *
 * `spent: false` gives the attempt back too, so going offline does not use up a rate limit's
 * retries. Reusing the number is safe: only the claimant gives a claim back, and a lapsed
 * lease is reclaimed as a higher attempt that a give-back never lowers.
 */
export async function retryJob(
  id: string,
  retry: { delayMs: number; spent?: boolean; because?: { kind: string; message: string } },
  attempt?: number,
): Promise<boolean> {
  const params: unknown[] = [
    id,
    retry.delayMs / 1000,
    retry.spent === false ? 1 : 0,
    retry.because?.kind ?? null,
    retry.because?.message ?? null,
  ];
  if (attempt !== undefined) params.push(attempt);
  const { rowCount } = await db().query(
    `with batch as (
       select b."stoppedAt" is not null as stopped
         from "regeneration_job" r join "regeneration_batch" b on b."id" = r."batchId"
        where r."id" = $1
          for share of b
     )
     update "regeneration_job" as j set
        "state"      = case when not s.stopped then 'pending'
                            when $4::text is null then 'cancelled' else 'failed' end,
        "notBefore"  = case when s.stopped then j."notBefore" else now() + make_interval(secs => $2) end,
        "attempts"   = case when s.stopped then j."attempts" else j."attempts" - $3 end,
        "errorKind"  = case when s.stopped then $4 else j."errorKind" end,
        "error"      = case when s.stopped then $5 else j."error" end,
        "finishedAt" = case when s.stopped then now() else j."finishedAt" end,
        "leaseUntil" = null, "relay" = null
       from batch s
      where j."id" = $1 ${claimed(attempt, 6)}`,
    params,
  );
  return (rowCount ?? 0) > 0;
}

/** False when the claim has been overtaken or the job settled: a remote worker then drops it. */
export async function renewLease(id: string, attempt: number, leaseMs: number = DEFAULT_LEASE_MS): Promise<boolean> {
  const { rowCount } = await db().query(
    `update "regeneration_job" set "leaseUntil" = now() + make_interval(secs => $3)
      where "id" = $1 and "state" = 'running' and "attempts" = $2`,
    [id, attempt, leaseMs / 1000],
  );
  return (rowCount ?? 0) > 0;
}

export async function claimForOwner(
  owner: string,
  providers: readonly Provider[],
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<QueueJob | null> {
  const { rows } = await db().query<QueueJob>(
    `with swept as (${LAPSED_AFTER_STOP})
     update "regeneration_job" as j set
        "state"      = 'running',
        "attempts"   = j."attempts" + 1,
        "leaseUntil" = now() + make_interval(secs => $1),
        "startedAt"  = coalesce(j."startedAt", now()),
        "relay"      = null
      where j."id" = (
        select "id" from "regeneration_job" r
         where ${DUE}
           and "owner" = $2 and "provider" = any($3::text[])
           and exists (select 1 from "generation_mode" m
                        where m."userId" = r."owner" and m."provider" = r."provider" and m."mode" = 'local')
         order by "id"
         for update skip locked
         limit 1
      )
      returning ${JOB_COLUMNS}`,
    [leaseMs / 1000, owner, providers],
  );
  return rows[0] ?? null;
}

export type RelayRecord = {
  fingerprints: string[];
  roster: { name: string; voiceId: string }[] | null;
};

export async function recordRelay(id: string, attempt: number, relay: RelayRecord): Promise<boolean> {
  const { rowCount } = await db().query(
    `update "regeneration_job" set "relay" = $3::jsonb
      where "id" = $1 and "state" = 'running' and "attempts" = $2`,
    [id, attempt, JSON.stringify(relay)],
  );
  return (rowCount ?? 0) > 0;
}

export async function relayedJob(
  id: string,
  owner: string,
  attempt: number,
): Promise<{ job: QueueJob; relay: RelayRecord } | null> {
  const { rows } = await db().query<QueueJob & { relay: RelayRecord | null }>(
    `select ${JOB_COLUMNS}, j."relay"
       from "regeneration_job" j
      where j."id" = $1 and j."owner" = $2 and j."attempts" = $3 and j."state" = 'running'`,
    [id, owner, attempt],
  );
  const row = rows[0];
  if (!row?.relay) return null;
  const { relay, ...job } = row;
  return { job, relay };
}

/** Work nobody holds: pending, or running on a lease that has lapsed. */
const WAITING = `("state" = 'pending' or ("state" = 'running' and "leaseUntil" < now()))`;

/**
 * Cancel everything still waiting, optionally within one batch or some languages.
 *
 * Running jobs whose lease is live are untouched: the characters are already at the provider
 * and will be billed, so discarding the audio would pay for nothing. Returns how many were
 * cancelled.
 *
 * `langs` is what the person pressing Stop may regenerate in: a Portuguese translator stops
 * the Portuguese queue and cannot stop anybody's English. Absent means every language,
 * which is the worker stopping a batch of its own.
 *
 * `by` is who pressed Stop, for the activity log; null when the worker stopped a batch
 * itself.
 */
export async function cancelPending(
  because: string,
  scope: { batchId?: string; langs?: readonly Lang[]; by?: string | null } = {},
): Promise<number> {
  const batchId = scope.batchId ?? null;
  const langs = scope.langs ?? null;

  // Every batch with unfinished work is stamped, a running job's included, so its retries fail
  // rather than run after Stop. Stamped before the jobs are cancelled, so a retry racing this
  // either sees the stop or is waited for and then cancelled (retryJob). Finished batches are
  // left alone: "Stopped by an admin" on one that ended cleanly would be the reason the panel
  // reads.
  const { rows: stamped } = await db().query<{ id: string; label: string; source: Source; lang: Lang }>(
    `update "regeneration_batch" as b
        set "stoppedAt" = now(), "stoppedBecause" = $1
      where b."stoppedAt" is null
        and ($2::uuid is null or b."id" = $2)
        and ($3::text[] is null or b."lang" = any($3))
        and exists (select 1 from "regeneration_job" j
                     where j."batchId" = b."id" and j."state" in ('pending', 'running'))
      returning b."id", b."label", b."source", b."lang"`,
    [because, batchId, langs],
  );

  const { rows: cancelled } = await db().query<{ batchId: string; count: number }>(
    `with cancelled as (
       update "regeneration_job" as j
          set "state" = 'cancelled', "finishedAt" = now(), "leaseUntil" = null, "relay" = null
        where ${WAITING}
          and ($1::uuid is null or j."batchId" = $1)
          and ($2::text[] is null or j."lang" = any($2))
          and exists (select 1 from "regeneration_batch" b
                       where b."id" = j."batchId" and b."stoppedAt" is not null)
        returning j."batchId"
     )
     select "batchId", count(*)::int as count from cancelled group by "batchId"`,
    [batchId, langs],
  );
  const counts = new Map(cancelled.map((row) => [row.batchId, row.count]));
  await recordActivities(
    stopEvents(
      stamped.map((batch) => ({ ...batch, cancelled: counts.get(batch.id) ?? 0 })),
      because,
      scope.by ?? null,
    ),
  );

  return cancelled.reduce((sum, row) => sum + row.count, 0);
}

/**
 * The log rows for one Stop. One press stops every batch with work waiting, and a batch
 * per Regenerate click is a batch of one or two lines, so one press was a screenful of
 * "stopped a batch" rows. Several batches in a language are one "queue.stopped" row, with
 * each batch's row carrying its group id for the page to fold, as cleared marks are
 * (migration 0057). One statement, so a group row never lands without its batches.
 */
function stopEvents(
  stopped: { id: string; label: string; source: Source; lang: Lang; cancelled: number }[],
  reason: string,
  actorId: string | null,
): ActivityEvent[] {
  const byLang = new Map<Lang, typeof stopped>();
  for (const batch of stopped) {
    const batches = byLang.get(batch.lang);
    if (batches) batches.push(batch);
    else byLang.set(batch.lang, [batch]);
  }

  return [...byLang.entries()].flatMap(([lang, batches]) => {
    const groupId = batches.length > 1 ? randomUUID() : null;
    const sources = new Set(batches.map((batch) => batch.source));
    const group: ActivityEvent[] = groupId
      ? [
          {
            kind: "queue.stopped",
            lang,
            // A press can stop quests and places batches alike; the row then names neither.
            source: sources.size === 1 ? batches[0].source : null,
            actorId,
            detail: {
              groupId,
              batches: batches.length,
              cancelled: batches.reduce((sum, batch) => sum + batch.cancelled, 0),
              reason,
            },
          },
        ]
      : [];
    return [
      ...group,
      ...batches.map(
        (batch): ActivityEvent => ({
          kind: "batch.stopped",
          lang,
          source: batch.source,
          subject: batch.id,
          actorId,
          detail: {
            batchId: batch.id,
            label: batch.label,
            reason,
            cancelled: batch.cancelled,
            ...(groupId ? { groupId } : {}),
          },
        }),
      ),
    ];
  });
}

/**
 * Stop claiming work in these languages until they are resumed.
 *
 * Jobs already running finish, as they do on Stop: their characters are at the provider and
 * billed either way. Pending work stays pending, and keeps its files under the credit guard.
 *
 * Answers with the languages this call paused, leaving out any already paused, so the
 * activity log records one pause per press that changed something rather than one per click.
 */
export async function pauseQueue(langs: readonly Lang[], by: string | null): Promise<Lang[]> {
  const { rows } = await db().query<{ lang: Lang }>(
    `insert into "regeneration_pause" ("lang", "pausedBy")
     select unnest($1::text[]), $2
     on conflict ("lang") do nothing
     returning "lang"`,
    [langs, by],
  );
  await recordActivities(
    rows.map((row) => ({ kind: "queue.paused" as const, lang: row.lang, actorId: by, detail: {} })),
  );
  return rows.map((row) => row.lang);
}

/** Lift the pause on these languages. Answers with the ones that were paused. */
export async function resumeQueue(langs: readonly Lang[], by: string | null): Promise<Lang[]> {
  const { rows } = await db().query<{ lang: Lang }>(
    `delete from "regeneration_pause" where "lang" = any($1::text[]) returning "lang"`,
    [langs],
  );
  await recordActivities(
    rows.map((row) => ({ kind: "queue.resumed" as const, lang: row.lang, actorId: by, detail: {} })),
  );
  return rows.map((row) => row.lang);
}

type JobAggregateRow = {
  pending: string;
  runningCount: string;
  done: string;
  failed: string;
  cancelled: string;
  credits: string;
  costUsd: string;
  unpriced: string;
  running: { source: Source; lang: Lang; lineId: string; npcName: string; preview: string }[];
  failures: { source: Source; lang: Lang; lineId: string; message: string }[];
  queues: {
    owner: string | null;
    name: string;
    pending: number;
    running: number;
    /** Null when everything the owner has left is in a paused language. */
    rank: number | null;
  }[];
  paused: { lang: Lang; pausedAt: string; by: string | null }[];
  finished: { id: string; source: Source; lang: Lang; lineId: string; file: string; version: number }[];
  cursor: string | null;
  through: string | null;
};

/**
 * The whole queue as the panel needs it.
 *
 * Scoped to the last day rather than to one batch: there is one ElevenLabs account and one
 * budget, so a batch someone else started is spending the same money and belongs on screen.
 *
 * One query against `regeneration_job` plus one against `regeneration_batch`, not seven: every
 * poll opens this many pooled connections, and with a leader and up to a dozen jobs already
 * holding their own, a poll that took one each was the tightest budget in the system. The job
 * query folds five aggregates and three ordered sub-lists into CTEs, with `json_agg` carrying
 * each list out as one column instead of one query per list - Postgres already builds those
 * lists in memory to answer the count, so asking it to hand them back costs nothing extra.
 */
/**
 * Wave away everything finished up to this job.
 *
 * Takes the id rather than reading the maximum itself, so what is dismissed is what the panel
 * was showing when the X was pressed. A job that finished in between stays news.
 */
export async function dismissThrough(jobId: string, userId: string | null): Promise<void> {
  await db().query(
    `insert into "queue_dismissal" ("id", "throughJobId", "dismissedBy")
     values (true, $1, $2)
     on conflict ("id") do update
        set "throughJobId" = greatest("queue_dismissal"."throughJobId", excluded."throughJobId"),
            "dismissedAt" = now(),
            "dismissedBy" = excluded."dismissedBy"`,
    [jobId, userId],
  );
}

export async function snapshot(
  since: string | null,
  options: { viewerId?: string | null; maxActive?: number; linesOf?: string } = {},
): Promise<QueueSnapshot> {
  const maxActive = options.maxActive ?? maxActiveFrom(process.env.QUEUE_MAX_ACTIVE);
  const viewerId = options.viewerId ?? null;
  // Whose running lines and failures to list: one owner's, or everybody's when unset. The
  // counts and the per-person queues stay whole either way, so a waiting batch still says
  // what it is waiting behind - only what is being said, and why it failed, is private.
  const linesOf = options.linesOf ?? null;
  // Live work first, then whatever finished recently: the two halves of what the panel is
  // for. Never just the age, for the reason WINDOW records.
  //
  // Terminal rows are also cut off at the dismissal watermark, which rides along as a CTE
  // rather than a second round trip: a poll costs two pooled queries and the test that pins
  // that is protecting the pool, not tidiness. Pending and running work is never cut off - a
  // queue still spending money must keep its panel and its Stop button, and dismissing
  // yesterday's run cannot be allowed to hide today's.
  const window =
    `("state" in ('pending', 'running') or ("queuedAt" > now() - interval '${WINDOW}' ` +
    `and "id" > (select through from dismissal)))`;

  const [job, latest] = await Promise.all([
    db().query<JobAggregateRow>(
      `with dismissal as (
         select coalesce((select "throughJobId" from "queue_dismissal" where "id"), 0) as through
       ),
       job_counts as (
         select
           count(*) filter (where "state" = 'pending')::text as pending,
           count(*) filter (where "state" = 'running')::text as "runningCount",
           count(*) filter (where "state" = 'done')::text as done,
           count(*) filter (where "state" = 'failed')::text as failed,
           count(*) filter (where "state" = 'cancelled')::text as cancelled,
           coalesce(sum("credits"), 0)::text as credits,
           coalesce(sum("costUsd"), 0)::text as "costUsd",
           count(*) filter (where "state" = 'done' and "credits" is null and "costUsd" is null)::text
             as unpriced
         from "regeneration_job"
         where ${window}
       ),
       running_jobs as (
         select "source", "lang", "lineId", "npcName", "preview" from "regeneration_job"
          where "state" = 'running' and ($2::text is null or "owner" = $2)
          order by "id" limit 20
       ),
       recent_failures as (
         select "source", "lang", "lineId", "error" as message from "regeneration_job"
          where "state" = 'failed' and ${window} and ($2::text is null or "owner" = $2)
          order by "id" desc limit 20
       ),
       finished_page as (
         select "id"::text as "id", "source", "lang", "lineId", "file", "version" from "regeneration_job"
          where "state" = 'done' and "version" is not null
            and "id" > greatest(coalesce($1::bigint, 0), (select through from dismissal))
          order by "id" limit ${FINISHED_PAGE}
       ),
       terminal as (
         select max("id")::text as max from "regeneration_job"
          where "state" in ('done', 'failed') and "id" > (select through from dismissal)
       ),
       queue_owners as (
         -- Ranked by the oldest job the worker may claim, as activeLanes ranks them, so a
         -- queue whose work is all paused has no place rather than one it is not using.
         select "owner",
                min("id") filter (where "lang" not in (select "lang" from "regeneration_pause"))
                  as first,
                count(*) filter (where "state" = 'pending')::int as pending,
                count(*) filter (where "state" = 'running')::int as running
           from "regeneration_job"
          where "state" in ('pending', 'running')
          group by "owner"
       ),
       ranked_queues as (
         select q."owner", coalesce(u."name", 'Deleted account') as name, q.pending, q.running,
                case when q.first is not null
                     then (row_number() over (order by q.first nulls last) - 1)::int end as rank
           from queue_owners q
           left join "user" u on u."id" = q."owner"
       ),
       pauses as (
         select p."lang", p."pausedAt", u."name" as by from "regeneration_pause" p
           left join "user" u on u."id" = p."pausedBy"
       ),
       shown as (
         select max("id")::text as max from "regeneration_job"
          where "state" in ('done', 'failed', 'cancelled') and ${window}
       )
       select
         jc.*,
         coalesce((select json_agg(r) from running_jobs r), '[]') as running,
         coalesce((select json_agg(f) from recent_failures f), '[]') as failures,
         coalesce((select json_agg(p) from finished_page p), '[]') as finished,
         coalesce((select json_agg(r order by r.rank nulls last, r.name) from ranked_queues r), '[]')
           as queues,
         coalesce((select json_agg(p order by p."lang") from pauses p), '[]') as paused,
         (select max from terminal) as cursor,
         (select max from shown) as through
       from job_counts jc`,
      [since, linesOf],
    ),
    db().query<{ stoppedBecause: string | null; cancelled: string }>(
      `select b."stoppedBecause",
              (select count(*)::text from "regeneration_job" j
                where j."batchId" = b."id" and j."state" = 'cancelled') as cancelled
         from "regeneration_batch" b order by b."createdAt" desc limit 1`,
    ),
  ]);

  const row = job.rows[0];
  const finished = row.finished;

  return {
    active: Number(row.pending) + Number(row.runningCount) > 0,
    counts: {
      pending: Number(row.pending),
      running: Number(row.runningCount),
      done: Number(row.done),
      failed: Number(row.failed),
      cancelled: Number(row.cancelled),
    },
    credits: Number(row.credits),
    costUsd: Number(row.costUsd),
    unpriced: Number(row.unpriced),
    running: row.running,
    failures: row.failures,
    latestBatch: latest.rows[0]
      ? {
          cancelled: Number(latest.rows[0].cancelled),
          stoppedBecause: latest.rows[0].stoppedBecause,
        }
      : null,
    paused: row.paused,
    queues: row.queues.map((queue) => ({
      owner: queue.owner,
      name: queue.name,
      pending: queue.pending,
      running: queue.running,
      status: queue.rank === null ? "paused" : queue.rank < maxActive ? "active" : "waiting",
      ahead: queue.rank === null || queue.rank < maxActive ? 0 : queue.rank,
      mine: viewerId !== null && queue.owner === viewerId,
    })),
    finished,
    // Normally the high-water mark of *all* terminal jobs, not just the page returned, so a
    // cursor never sticks behind a job that failed rather than finished. But a full page
    // means there are more done jobs than fit, and taking the global maximum then would skip
    // every one after it - lines the page would never learn had been regenerated. A full page
    // therefore ends at its own last row, and the next poll picks up from there.
    cursor:
      finished.length === FINISHED_PAGE ? finished[finished.length - 1].id : (row.cursor ?? since ?? "0"),
    through: row.through,
  };
}
