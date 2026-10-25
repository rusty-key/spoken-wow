/**
 * The drain loop.
 *
 * What Explorer.runBatch used to be, moved to the server and no longer sequential: while
 * this process leads, it keeps each owner's lanes at their own key's budget, at most
 * QUEUE_MAX_ACTIVE owners at a time, claiming another job whenever one settles.
 *
 * The single call that costs money is injectable for the reason tts.ts injects fetch: no
 * test may need an ElevenLabs account, and none may ever spend credits. Everything else here
 * runs against the real queue, because the exclusions that keep it honest are in the schema.
 */
import { readApiKey } from "@/lib/api-key";
import { POOL_MAX } from "@/lib/db";

import { afterRateLimit, budgetFor, clampToPool, maxActiveFrom, pickLane } from "./concurrency";
import {
  activeLanes,
  batchStopped,
  claimNext,
  failJob,
  finishJob,
  laneKey,
  retryJob,
  type Lane,
  type QueueJob,
} from "./queue";
import { regenerateLine, type RegenerateResult } from "./regenerate";
import { regenerateBookLine } from "@/lib/readables/regenerate";
import { regenerateZoneLine } from "@/lib/places/regenerate";
import { generationStatus } from "./status";
import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";
import { fishConcurrency, getWallet } from "@/lib/voices/fish";
import { readGenerationSettings, type Preference } from "./preference";
import { speakerFrom } from "./speakers/for";
import type { Provider, Speaker } from "./speakers/speaker";
import { PROVIDER_NAME } from "./providers";
import type { GenerateOptions } from "./generate-options";

/**
 * How many times a rate-limited job is retried before it is failed.
 *
 * Three rather than forever: a limit that has not lifted in three backoffs is a condition
 * someone needs to see, not one to keep spending requests on.
 */
export const MAX_ATTEMPTS = 3;

export const BACKOFF_BASE_MS = 3_000;

/**
 * Exponential backoff with full jitter, as ElevenLabs recommends.
 *
 * Full jitter rather than a fixed delay because a rate limit hits several in-flight jobs at
 * once, and retrying them all after the same interval reproduces the burst that caused it.
 */
export function backoffFor(attempts: number, random: () => number = Math.random): number {
  return Math.floor(random() * BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

/**
 * The budget the account currently allows, from the tier and the model in force.
 *
 * Clamped to what the pool can serve: an ElevenLabs plan the account is upgraded to next year
 * must not be able to raise this past the number of connections available to spend it, which
 * is a deadlock rather than a slow batch.
 *
 * The key says whose plan. Every job is generated with its own owner's credentials, so the
 * worker asks this once per lane - one owner, one provider, one key - and caches the answer.
 */
export async function currentBudget(
  apiKey: string | null,
  provider: Provider,
  modelId: string,
): Promise<number> {
  if (provider === "fish" && apiKey) return clampToPool(await fishBudget(apiKey), POOL_MAX);
  const status = await generationStatus(apiKey ? { apiKey } : {});
  // The model the lane's owner has chosen for this provider, as it stands now: the flash and
  // turbo families have their own concurrency, and the model is the owner's choice, not the site's.
  const plan = budgetFor(status.subscription?.tier ?? null, modelId);
  return clampToPool(plan, POOL_MAX);
}

/** fish.audio's tier, read at most once a minute per key: a pump runs every time a job settles. */
const FISH_BUDGET_TTL_MS = 60_000;
const fishBudgets = new Map<string, { at: number; value: Promise<number> }>();

/**
 * What a fish.audio account may have in flight, less one for the single-line button, as
 * budgetFor leaves ElevenLabs. A balance that cannot be read is the lowest tier's, since
 * guessing high is how a batch meets 429s.
 */
async function fishBudget(apiKey: string): Promise<number> {
  const cached = fishBudgets.get(apiKey);
  if (cached && Date.now() - cached.at < FISH_BUDGET_TTL_MS) return cached.value;
  const value = getWallet({ apiKey })
    .then((wallet) => fishConcurrency(wallet.cumulativeTopUp))
    .catch(() => fishConcurrency(0))
    .then((limit) => Math.max(1, limit - 1));
  fishBudgets.set(apiKey, { at: Date.now(), value });
  return value;
}

/** How long a lane's width is trusted before its owner's plan is read again. */
const LANE_WIDTH_TTL_MS = 60_000;

/**
 * What the worker keeps about one lane.
 *
 * Its own in-flight count, width and cool-down, because a lane is one API key: one owner's
 * 429 is about their plan, and halving everyone else for it was the old single-queue bug.
 */
type LaneState = {
  running: number;
  rateLimitedAt: number | null;
  /**
   * The lane's width and when it was read. `known` is the settled number once there is one,
   * which is what lets a stale width keep being served while its refresh is in flight.
   */
  width: { at: number; value: Promise<number>; known: number | null } | null;
  /** Whether a refresh of a stale width is in flight, so a burst of pumps starts only one. */
  refreshing: boolean;
};

/**
 * How one job is generated.
 *
 * A function per source rather than one that switches inside, so adding a section is adding
 * an entry here and the loop below stays the loop. Every one takes the same three arguments
 * because that is all a job carries: which line, whose credits, the key to spend them, and
 * the language to speak it in.
 */
export type Generator = (
  lineId: string,
  userId: string,
  options: GenerateOptions & { lang: Lang },
) => Promise<RegenerateResult>;

export type WorkerOptions = {
  /**
   * Overrides per source, for tests. A source with no entry falls back to the real
   * generator for it; there is no default that would quietly generate the wrong corpus.
   */
  regenerate?: Partial<Record<Source, Generator>>;
  budget?: (apiKey: string | null, provider: Provider, modelId: string) => Promise<number>;
  /** The owner's stored key. Injectable so a test never needs one sealed in a database. */
  apiKeyFor?: (userId: string, provider: Provider) => Promise<string | null>;
  /** The owner's settings for each provider, read as each job runs. */
  preferenceFor?: (userId: string) => Promise<Pick<Preference, "elevenlabs" | "fish">>;
  backoffMs?: (attempts: number) => number;
  leaseMs?: number;
  /** How long to wait before looking again when the queue was empty. */
  idleMs?: number;
  /** How many owners' queues drain at once. Defaults to QUEUE_MAX_ACTIVE, else three. */
  maxActive?: number;
};

export type Worker = {
  stop(): Promise<void>;
  /** Look for work now rather than at the next idle tick. Called after an enqueue. */
  nudge(): void;
  inFlight(): number;
};

export function startWorker(isLeader: () => boolean, options: WorkerOptions = {}): Worker {
  // A source with no generator cannot have its jobs claimed, and a claim for one is a bug
  // rather than a state to handle - it fails as one, loudly, rather than being handed to
  // the quests generator and asked for a line id that corpus has never heard of. The
  // Record is total on purpose: adding a source to the type and forgetting it here is a
  // type error, which is how readables arrived without a silent gap.
  const generators: Record<Source, Generator | null> = {
    quests: options.regenerate?.quests ?? regenerateLine,
    places: options.regenerate?.places ?? regenerateZoneLine,
    readables: options.regenerate?.readables ?? regenerateBookLine,
  };

  const budget = options.budget ?? currentBudget;
  const apiKeyFor = options.apiKeyFor ?? readApiKey;
  const preferenceFor = options.preferenceFor ?? readGenerationSettings;
  const backoff = options.backoffMs ?? backoffFor;
  const idleMs = options.idleMs ?? 2_000;
  const maxActive = options.maxActive ?? maxActiveFrom(process.env.QUEUE_MAX_ACTIVE);
  /** The whole worker's ceiling, whatever the lanes' keys would allow: see clampToPool. */
  const cap = clampToPool(Number.MAX_SAFE_INTEGER, POOL_MAX);

  const running = new Set<Promise<void>>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let pumping = false;

  const lanes = new Map<string, LaneState>();

  function stateOf(key: string): LaneState {
    let state = lanes.get(key);
    if (!state) {
      state = { running: 0, rateLimitedAt: null, width: null, refreshing: false };
      lanes.set(key, state);
    }
    return state;
  }

  /**
   * Forget lanes with nothing in flight that are no longer active, so the map does not grow
   * with every owner who ever queued anything. A lane with jobs in flight is kept: those jobs
   * hold its state and will decrement it when they settle.
   */
  function forgetIdle(active: ReadonlySet<string>): void {
    for (const [key, state] of lanes) {
      if (state.running === 0 && !active.has(key)) lanes.delete(key);
    }
  }

  /**
   * What the lane's owner's plan allows, read at most once a minute.
   *
   * A key or settings that cannot be read is a width of one rather than an error: each job
   * then claimed fails as `auth` in run(), one at a time, which is the answer the owner needs
   * to see.
   *
   * STALE WHILE REVALIDATE. pump() waits for every active lane's width before claiming
   * anything, and reading a plan is a network call with no timeout of its own. Awaited on
   * every expiry, one owner's slow plan read would stall every lane, everyone's queue waiting
   * on someone else's provider. So only a lane's very first read is awaited; after that an
   * expired width is refreshed in the background and the last one served meanwhile. A refresh
   * that fails keeps the width the lane already had - a blip is no reason to drop a working
   * lane to one - and is tried again a minute later rather than on every pump.
   */
  function widthOf(lane: Lane, state: LaneState): Promise<number> {
    const cached = state.width;
    if (cached && Date.now() - cached.at < LANE_WIDTH_TTL_MS) return cached.value;

    const owner = lane.owner ?? "";
    const read = async () => {
      const apiKey = await apiKeyFor(owner, lane.provider);
      if (!apiKey) return 1;
      const speaker = speakerFrom(lane.provider, apiKey, await preferenceFor(owner));
      return budget(apiKey, lane.provider, speaker.modelId);
    };

    if (cached && cached.known !== null) {
      if (!state.refreshing) {
        state.refreshing = true;
        const previous = cached.known;
        read()
          .then(
            (value) => (state.width = { at: Date.now(), value: Promise.resolve(value), known: value }),
            () => (state.width = { at: Date.now(), value: Promise.resolve(previous), known: previous }),
          )
          .finally(() => (state.refreshing = false));
      }
      return cached.value;
    }

    const value = read().catch(() => 1);
    const entry: NonNullable<LaneState["width"]> = { at: Date.now(), value, known: null };
    state.width = entry;
    void value.then((width) => (entry.known = width));
    return value;
  }

  async function run(job: QueueJob, lane: LaneState): Promise<void> {
    // Whose credits this line is spent from. A batch is enqueued by someone who had a key at
    // the time, so reaching here without one means it was cleared or the master key changed
    // underneath it. Failed as this job only, like every failure below: see the note there.
    //
    // For the provider the job was queued with, not whichever the owner has chosen since.
    let apiKey: string | null;
    try {
      apiKey = await apiKeyFor(job.createdBy ?? "", job.provider);
    } catch {
      apiKey = null;
    }

    if (!apiKey) {
      const message =
        `the account that started this batch has no usable ${PROVIDER_NAME[job.provider]} key; set one in your` +
        " profile and start it again";
      await failJob(job.id, { kind: "auth", message }, job.attempts).catch((error: unknown) =>
        console.error(`regeneration queue: job ${job.id} could not be failed`, error),
      );
      return;
    }
    // The owner's own settings, read per job so an edit on /voices applies to later lines.
    // Caught like the key above: a database that will not answer here is one line's failure,
    // recorded on the job, never a rejection that nothing awaits.
    let speaker: Speaker;
    try {
      speaker = speakerFrom(job.provider, apiKey, await preferenceFor(job.createdBy ?? ""));
    } catch (error) {
      const message = `could not read the settings of the account that started this batch: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await failJob(job.id, { kind: "upstream", message }, job.attempts).catch((failure: unknown) =>
        console.error(`regeneration queue: job ${job.id} could not be failed`, failure),
      );
      return;
    }
    const generate = generators[job.source];
    if (!generate) {
      const message = `no generator for ${job.source} jobs in this build`;
      await failJob(job.id, { kind: "bad-request", message }, job.attempts).catch((error: unknown) =>
        console.error(`regeneration queue: job ${job.id} could not be failed`, error),
      );
      return;
    }

    // A batch whose owner's account was deleted still has takes to attribute, and
    // take."createdBy" is nullable for exactly that case.
    const result = await generate(job.lineId, job.createdBy ?? "", {
      speaker,
      lang: job.lang,
      batchId: job.batchId,
    }).catch(
      (error: unknown): RegenerateResult => ({
        ok: false,
        failure: {
          kind: "upstream",
          message: error instanceof Error ? error.message : String(error),
          status: 502,
          fatal: false,
        },
      }),
    );

    await settle(job, result, {
      backoffMs: backoff,
      onRateLimit: () => (lane.rateLimitedAt = Date.now()),
    });
  }

  /**
   * Fill the free slots lane by lane, then arrange to be called again.
   *
   * Which lanes may run is the queue's answer (activeLanes); how many each gets is its own
   * key's width, less while it is cooling down, shared under the pool cap by pickLane.
   *
   * Guarded by `pumping` because a job settling calls this at the same time as the idle
   * timer, and two pumps interleaving would claim past the budget.
   */
  async function pump(): Promise<void> {
    if (pumping || stopped) return;
    pumping = true;
    try {
      if (!isLeader()) return;

      const open = await Promise.all(
        (await activeLanes(maxActive)).map(async (lane) => {
          const key = laneKey(lane);
          const state = stateOf(key);
          return { lane, key, state, width: await widthOf(lane, state) };
        }),
      );
      forgetIdle(new Set(open.map((entry) => entry.key)));

      while (!stopped && isLeader()) {
        // The cool-down is applied per claim, not once per pump: one pump can outlive many
        // jobs, each settle refilling its slot from inside this loop, and a 429 that lands
        // meanwhile must narrow the lane from the next claim on - not once the loop drains.
        const now = Date.now();
        const key = pickLane(
          open.map((entry) => ({
            key: entry.key,
            running: entry.state.running,
            width: afterRateLimit(entry.width, entry.state.rateLimitedAt, now),
          })),
          running.size,
          cap,
        );
        if (!key) return;
        const chosen = open.find((entry) => entry.key === key)!;

        const job = await claimNext(options.leaseMs, chosen.lane);
        if (!job) {
          // Everything left in this lane is backing off. Dropped for this pump only; the idle
          // tick asks again, and the other lanes keep their slots meanwhile.
          open.splice(open.indexOf(chosen), 1);
          continue;
        }

        if (stopped) {
          // A stop landed while this claim's round trip was in flight. claimNext already
          // marked the row "running" and spent one of its attempts; handing it back with
          // retryJob rather than starting it is what keeps a rolling deploy's SIGTERM from
          // stranding the row for its whole five-minute lease. Losing an attempt to a
          // deploy that never actually tried the job is the fair side of that trade.
          await retryJob(job.id, 0, job.attempts);
          return;
        }

        const state = chosen.state;
        state.running += 1;
        const work = run(job, state).finally(() => {
          running.delete(work);
          state.running -= 1;
          // Settling frees a slot, so look for the next job immediately rather than waiting
          // out an idle tick - that wait is what would make this only nominally parallel.
          if (!stopped) void pump();
        });
        running.add(work);
      }
    } catch {
      // A database blip must not kill the loop; the next tick tries again.
    } finally {
      pumping = false;
      if (!stopped && !timer) {
        timer = setTimeout(() => {
          timer = null;
          void pump();
        }, idleMs);
      }
    }
  }

  void pump();

  return {
    nudge: () => void pump(),
    inFlight: () => running.size,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Looped rather than a single snapshot: a claim already in flight when stop() was
      // called can still land in `running` after the first snapshot is taken (the check
      // above closes that for new claims, but this is what makes "stopped" mean quiescent
      // rather than merely likely). Awaited rather than abandoned either way: these
      // requests are already at ElevenLabs and will be billed, so dropping them would pay
      // for audio nobody gets. This is what makes kill_timeout in ecosystem.config.js
      // load-bearing.
      while (running.size > 0) {
        await Promise.allSettled([...running]);
      }
    },
  };
}

/**
 * Record what generating a job came to: done, backed off after a rate limit, or failed.
 *
 * The same for a job this process generated and one a Spoken Manager generated
 * (lib/worker/relay.ts), so the two cannot drift on when a job is retried.
 *
 * Wrapped because a database blip here is expensive in a way a failed generation is not: the
 * money has already been spent, and a row left `running` has its lease reclaimed five minutes
 * later and the same file generated and paid for a second time. Nothing can be done about it
 * from here beyond saying so loudly enough that the log explains the duplicate charge.
 *
 * Every write is made against the claim's attempt, so a job whose lease ran out and was
 * claimed again is settled by its newer claim only.
 */
export async function settle(
  job: QueueJob,
  result: RegenerateResult,
  options: { backoffMs?: (attempts: number) => number; onRateLimit?: () => void } = {},
): Promise<void> {
  const backoff = options.backoffMs ?? backoffFor;
  try {
    if (result.ok) {
      await finishJob(
        job.id,
        { version: result.version, credits: result.credits, costUsd: result.costUsd },
        job.attempts,
      );
      return;
    }

    const { kind, message } = result.failure;

    if (kind === "rate-limit") {
      options.onRateLimit?.();
      // A retry puts the row back to `pending`, where it would be claimed and paid for
      // after an admin pressed Stop - and where it would flip the queue back to active, so
      // the panel returns to "Regenerating" having just said "Stopped". Stop means stop.
      if (job.attempts < MAX_ATTEMPTS && !(await batchStopped(job.batchId))) {
        await retryJob(job.id, backoff(job.attempts), job.attempts);
        return;
      }
    }

    // Only this job fails; the rest of its batch carries on, whatever `fatal` says. `fatal`
    // is the browser's contract (errors.ts) and assumes a batch is one voice and one key,
    // which a queued batch is not: a "Regenerate all" spans every NPC slot, and cancelling
    // it for one slot with no voice takes down every line that has one. Even an
    // account-wide failure - no credits, a revoked key - is refused before anything is
    // billed, so letting each remaining line fail on its own costs nothing but log rows.
    await failJob(job.id, { kind, message }, job.attempts);
  } catch (error) {
    console.error(
      `regeneration queue: job ${job.id} (${job.file}) settled but its outcome could not be` +
        ` recorded; it will be reclaimed after its lease and generated again`,
      error,
    );
  }
}
