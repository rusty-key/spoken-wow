/**
 * Settles the active release run from its job on this machine or from GitHub, so the page needs
 * no webhook: whoever looks at it moves it on.
 */
import "server-only";

import { currentStep, failureReason, outcome, readDropletRun, readStaged, runsOnDroplet, type DropletRun } from "./droplet";
import { tellOwnersOfReview, tellPresser } from "./notify";
import { GithubNotConfiguredError, findRun, type GithubRun } from "./github";
import { startNext } from "./launch";
import {
  activeOrQueued, applyUpdate, runById, updateRun, type ReleaseRun, type SelectedTakes, type StagedRelease,
} from "./store";

// Twelve missed heartbeats. A reboot or an out-of-memory kill leaves no exit file, and nobody
// could press Release until someone noticed.
const JOB_LOST_AFTER_MS = 3 * 60_000;
// Past launchRun's encoding budget (takes/encode.ts encodeMissingForPack) and the spawn after it,
// which makes the run's directory. A reload between claiming a queued run and spawning its job
// leaves it dispatching with none, and the queue behind it would wait out GIVE_UP_AFTER_MS.
const NEVER_STARTED_AFTER_MS = 2 * 60_000;
const CHECK_EVERY_MS = 15_000;
const GIVE_UP_AFTER_MS = 15 * 60_000;
// Past the workflow's 240-minute timeout with another run queued ahead of it. An expired token
// answers every check with an error, and nobody could press Release until someone noticed.
const LOST_AFTER_MS = 9 * 60 * 60_000;

// Only the question to GitHub is memoised; the row is always read fresh, so a run started
// a moment ago shows at once. Keyed by run, so a new run is asked about straight away.
let checked: { runId: string; at: number } | null = null;

export function forgetReleaseCheck(): void {
  checked = null;
}

async function lookup(run: ReleaseRun, fetchFn: typeof fetch): Promise<{ found: GithubRun | null } | "error"> {
  try {
    return { found: await findRun(run.id, fetchFn) };
  } catch (error) {
    // With no token the age rule must still free the lock, or the press stays stuck for ever.
    if (error instanceof GithubNotConfiguredError) return { found: null };
    console.error(`release ${run.id}: GitHub check failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return "error";
  }
}

/** A job that exited: its outcome, and for a staged release, what it staged. */
async function settle(run: ReleaseRun, job: DropletRun & { exitCode: number }): Promise<void> {
  if (job.exitCode !== 0) {
    await updateRun(run.id, { state: "failed", error: failureReason(job.log, job.exitCode) });
    return;
  }
  const result = outcome(job.log);
  if (result.state !== "awaiting_review") {
    const { changed } = await applyUpdate(run.id, result);
    // The version a site owner approved is what players have now.
    const promoted = changed && run.kind === "promote" && run.promotes ? await runById(run.promotes) : null;
    if (promoted?.state === "done") await tellPresser(promoted, "approved");
    return;
  }
  const read = (await readStaged(run.id)) as (StagedRelease & { takes?: SelectedTakes }) | null;
  if (!read || !("packs" in read) || Object.keys(read.packs).length === 0) {
    await updateRun(run.id, { state: "failed", error: "The release staged nothing the site could read" });
    return;
  }
  // What it was built from goes beside it, for the review: the promotion lists `staged` alone.
  const { takes, ...staged } = read;
  const selected = takes && typeof takes === "object" && !Array.isArray(takes) ? takes : null;
  const { run: settled, changed } = await applyUpdate(run.id, { ...result, staged, takes: selected });
  if (changed) await tellOwnersOfReview(settled);
}

async function settleFromJob(run: ReleaseRun, job: DropletRun, now: number): Promise<ReleaseRun | null> {
  if (job.exitCode !== null) {
    await settle(run, { ...job, exitCode: job.exitCode });
    return null;
  }
  if (now - job.heartbeatAt > JOB_LOST_AFTER_MS) {
    await updateRun(run.id, { state: "failed", error: "The release process stopped without finishing" });
    return null;
  }
  const step = currentStep(job.log);
  if (run.state === "running" && run.step === (step ?? run.step)) return run;
  const updated = await updateRun(run.id, { state: "running", step });
  return updated.state === "running" ? updated : null;
}

/**
 * The active run after moving it on, or the queued run that starts because none is active any
 * more; null when nothing runs. With nothing active or queued, one query.
 */
export async function syncActive(fetchFn: typeof fetch = fetch, now: number = Date.now()): Promise<ReleaseRun | null> {
  const active = await activeOrQueued();
  if (active === null) return null;
  if (active !== "queued") {
    const run = await syncRun(active, fetchFn, now);
    if (run) return run;
  }
  return startNext();
}

async function syncRun(run: ReleaseRun, fetchFn: typeof fetch, now: number): Promise<ReleaseRun | null> {
  const job = await readDropletRun(run.id);
  if (job) return settleFromJob(run, job, now);
  // A young one may still be a run GitHub was given before this machine ran the jobs.
  if (runsOnDroplet() && run.state === "dispatching" && now - (run.startedAt ?? run.createdAt).getTime() > NEVER_STARTED_AFTER_MS) {
    await updateRun(run.id, { state: "failed", error: "Its job never started: the site restarted before it could" });
    return null;
  }
  if (checked && checked.runId === run.id && now - checked.at < CHECK_EVERY_MS) return run;
  checked = { runId: run.id, at: now };

  const result = await lookup(run, fetchFn);
  if (result === "error" || !result.found) {
    const [limit, error] = result === "error"
      ? [LOST_AFTER_MS, "Lost track of it: GitHub stopped answering"]
      : [GIVE_UP_AFTER_MS, "GitHub never started it"];
    if (now - (run.startedAt ?? run.createdAt).getTime() < limit) return run;
    await updateRun(run.id, { state: "failed", error });
    return null;
  }
  const { found } = result;

  if (found.status === "completed") {
    await updateRun(
      run.id,
      found.conclusion === "success"
        ? { state: "done", githubRunId: found.id, githubUrl: found.url }
        : { state: "failed", githubRunId: found.id, githubUrl: found.url, error: found.conclusion ?? "unknown" },
    );
    return null;
  }
  // Between steps GitHub names none, and the row keeps the last one.
  if (run.state === "running" && run.githubRunId === found.id && run.step === (found.step ?? run.step)) return run;
  const updated = await updateRun(run.id, { state: "running", githubRunId: found.id, githubUrl: found.url, step: found.step });
  return updated.state === "running" ? updated : null;
}
