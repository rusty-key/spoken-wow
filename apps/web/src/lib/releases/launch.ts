/**
 * Starting a run's job: a new run (a press, an approval or a delisting) that found the lock free,
 * or the oldest queued run once the active one settles.
 */
import "server-only";

import { encodeMissingForPack } from "@/lib/takes/encode";

import { runsOnDroplet, startDropletRun } from "./droplet";
import { dispatchRelease } from "./github";
import { claimNext, updateRun, type ReleaseRun } from "./store";
import { syncActive } from "./sync";

export type Launch = (run: ReleaseRun) => Promise<void>;

export async function launchRun(run: ReleaseRun): Promise<void> {
  // A take whose encoding failed at commit would stop the release; a promotion builds nothing.
  if (run.kind === "release") await encodeMissingForPack(run.section, run.lang, run.teamId);
  if (runsOnDroplet()) return startDropletRun(run);
  if (run.kind !== "release") throw new Error(`a ${run.kind} runs only on the machine that signs the channel`);
  return dispatchRelease(run);
}

const failureOf = (error: unknown) => (error instanceof Error ? error.message : "the release could not be started");

/** A new run whose job could not start; the run is `failed` with the same reason. */
export class LaunchError extends Error {}

/**
 * Makes a run with `insert` and starts it if it took the lock; a queued one waits for startNext.
 * A finished run is settled first, or it would hold the lock until somebody happened to look. A
 * job that cannot start settles the run `failed`, starts the next, and throws LaunchError.
 */
export async function launchNew(insert: () => Promise<ReleaseRun>, launch: Launch = launchRun): Promise<ReleaseRun> {
  await syncActive();
  const run = await insert();
  if (run.state !== "dispatching") return run;
  await launchStarted(run, launch);
  return run;
}

/** Starts the job of a new run that took the lock, as launchNew does once it has inserted one. */
export async function launchStarted(run: ReleaseRun, launch: Launch = launchRun): Promise<void> {
  try {
    await launch(run);
  } catch (error) {
    await updateRun(run.id, { state: "failed", error: failureOf(error) });
    await startNext(launch);
    throw new LaunchError(failureOf(error));
  }
}

/**
 * Starts the oldest queued run when nothing is active, and returns it. A run whose job cannot
 * start settles `failed` and the next is tried, so one bad run never stalls the queue.
 */
export async function startNext(launch: Launch = launchRun): Promise<ReleaseRun | null> {
  for (;;) {
    const run = await claimNext();
    if (!run) return null;
    try {
      await launch(run);
      return run;
    } catch (error) {
      await updateRun(run.id, { state: "failed", error: failureOf(error) });
    }
  }
}
