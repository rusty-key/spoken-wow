/**
 * Settles the active release run from GitHub, so the page needs no webhook: whoever looks
 * at it moves it on.
 */
import "server-only";

import { GithubNotConfiguredError, findRun, type GithubRun } from "./github";
import { activeRun, updateRun, type ReleaseRun } from "./store";

const CHECK_EVERY_MS = 15_000;
const GIVE_UP_AFTER_MS = 15 * 60_000;
// Past the workflow's 240-minute timeout with another run queued ahead of it. An expired token
// answers every check with an error, and nobody could press Release until someone noticed.
const LOST_AFTER_MS = 9 * 60 * 60_000;

// Only the question to GitHub is memoised; the row is always read fresh, so a run started
// a moment ago shows at once. Keyed by run, so a new run is asked about straight away.
let checked: { runId: string; at: number } | null = null;

/** Drops the memo. For tests. */
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

export async function syncActive(fetchFn: typeof fetch = fetch, now: number = Date.now()): Promise<ReleaseRun | null> {
  const run = await activeRun();
  if (!run) return null;
  if (checked && checked.runId === run.id && now - checked.at < CHECK_EVERY_MS) return run;
  checked = { runId: run.id, at: now };

  const result = await lookup(run, fetchFn);
  if (result === "error" || !result.found) {
    const [limit, error] = result === "error"
      ? [LOST_AFTER_MS, "Lost track of it: GitHub stopped answering"]
      : [GIVE_UP_AFTER_MS, "GitHub never started it"];
    if (now - run.createdAt.getTime() < limit) return run;
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
