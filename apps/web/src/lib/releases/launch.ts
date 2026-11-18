/**
 * Starting a run's job: a press that found the lock free, or the oldest queued run once the
 * active one settles.
 */
import "server-only";

import { encodeMissingForPack } from "@/lib/takes/encode";

import { runsOnDroplet, startDropletRun } from "./droplet";
import { dispatchRelease } from "./github";
import { claimNext, updateRun, type ReleaseRun } from "./store";

export type Launch = (run: ReleaseRun) => Promise<void>;

export async function launchRun(run: ReleaseRun): Promise<void> {
  // A take whose encoding failed at commit would stop the release; a promotion builds nothing.
  if (run.kind === "release") await encodeMissingForPack(run.section, run.lang, run.teamId);
  if (runsOnDroplet()) return startDropletRun(run);
  if (run.kind !== "release") throw new Error(`a ${run.kind} runs only on the machine that signs the channel`);
  return dispatchRelease(run);
}

export const failureOf = (error: unknown) => (error instanceof Error ? error.message : "the release could not be started");

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
