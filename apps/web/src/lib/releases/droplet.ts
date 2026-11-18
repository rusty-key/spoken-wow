/**
 * A release as a process on this machine (scripts/manager/release-job.mjs). It must outlive the
 * worker that started it: a deploy reloads pm2, which kills a worker's whole process tree, so the
 * job is forked away with setsid, and reports through files both workers can read.
 */
import "server-only";

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { closeSync, openSync, realpathSync } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ReleaseBump, ReleaseKind } from "./sections";

const LOG_TAIL_BYTES = 8_000;

export type DropletRun = {
  log: string;
  /** The log was longer than the tail kept, so its start is missing. */
  logCut: boolean;
  /** Null until the job has finished. */
  exitCode: number | null;
  heartbeatAt: number;
};

/** No release.env means Actions, as a way back. */
export function runsOnDroplet(): boolean {
  return Boolean(process.env.SPOKEN_RELEASE_ENV);
}

/**
 * Whether a team that is not official, or not the language's privileged team, may release: only
 * where SPOKEN_TEAM_RELEASES=1. Staging sets it; production sets it once a Manager and a Spoken
 * that list a team's packs have shipped. On the droplet only: the workflow builds from a synced
 * database, whose sync gives every take to the privileged team. A release of a team that is not
 * official waits for a site owner's review either way.
 */
export function teamReleasesOpen(): boolean {
  return process.env.SPOKEN_TEAM_RELEASES === "1" && runsOnDroplet();
}

/**
 * Whether the acting team (actingTeamRow) is refused a release here: one that is not both official
 * and the language's privileged team, where team releases are not open. No team is not refused.
 * The job refuses the same teams, whose packs it lists under the team
 * (scripts/manager/release-pack.mjs needsTeamReleases), so a press accepted here is one it builds.
 */
export function releasesClosedFor(team: { official: boolean; privileged: boolean } | null): boolean {
  return team !== null && !(team.official && team.privileged) && !teamReleasesOpen();
}

function runDir(id: string): string | null {
  const env = process.env.SPOKEN_RELEASE_ENV;
  return env ? join(dirname(env), "release-runs", id) : null;
}

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type DropletJob = {
  id: string;
  kind: ReleaseKind;
  section: string;
  lang: string;
  teamSlug: string;
  bump: ReleaseBump | null;
  stage: boolean;
  /** What a promote lists, or a delist's `{ folders }`, handed to the job as input.json. */
  staged: unknown;
};

/** The job's arguments after its run directory. */
export function jobArgs(run: DropletJob): string[] {
  // The team as a flag, after the positionals: a job from before teams released had none.
  return [
    run.section, run.lang, run.bump ?? "patch", `--team=${run.teamSlug}`,
    ...(run.kind === "release" ? (run.stage ? ["--stage"] : []) : [`--kind=${run.kind}`]),
  ];
}

export async function startDropletRun(run: DropletJob, spawnFn: Spawn = spawn): Promise<void> {
  const dir = runDir(run.id);
  if (!dir) throw new Error("releases on this machine need SPOKEN_RELEASE_ENV set");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "heartbeat"), "");
  await writeFile(join(dir, "log"), "");
  if (run.kind !== "release") await writeFile(join(dir, "input.json"), JSON.stringify(run.staged));

  // Resolved now, so the job keeps the release it started from through a symlink swap.
  const tools = realpathSync(join(process.env.SPOKEN_PLACES_ROOT ?? process.cwd(), "release-tools"));
  const log = openSync(join(dir, "log"), "a");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawnFn(
        "setsid",
        // The site keeps the machine's one CPU.
        ["--fork", "nice", "-n", "10", process.execPath, join(tools, "scripts/manager/release-job.mjs"), dir, ...jobArgs(run)],
        {
          cwd: tools,
          env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, SPOKEN_RELEASE_ENV: process.env.SPOKEN_RELEASE_ENV },
          stdio: ["ignore", log, log],
        },
      );
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`setsid exited ${code}`))));
    });
  } finally {
    closeSync(log);
  }
}

async function tail(path: string): Promise<{ text: string; cut: boolean }> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    const { buffer } = await file.read(Buffer.alloc(length), 0, length, size - length);
    const text = buffer.toString("utf8");
    // A cut line reads as a garbled one.
    return size > length ? { text: text.slice(text.indexOf("\n") + 1), cut: true } : { text, cut: false };
  } finally {
    await file.close();
  }
}

/** Null for a run this machine did not start, which is one for GitHub to answer about. */
export async function readDropletRun(id: string): Promise<DropletRun | null> {
  const dir = runDir(id);
  if (!dir) return null;
  try {
    const [log, beat] = await Promise.all([tail(join(dir, "log")), stat(join(dir, "heartbeat"))]);
    const exit = await readFile(join(dir, "exit"), "utf8").catch(() => null);
    return { log: log.text, logCut: log.cut, exitCode: exit === null ? null : Number(exit), heartbeatAt: beat.mtimeMs };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

/** The step release.mjs last announced, e.g. "lookup, step 2 of 5". */
export function currentStep(log: string): string | null {
  const steps = [...log.matchAll(/^==> step (\d+)\/(\d+): (.+)$/gm)];
  const last = steps.at(-1);
  return last ? `${last[3]}, step ${last[1]} of ${last[2]}` : null;
}

/**
 * What the last line of a job that exited 0 says came of it. A staged release waits for review;
 * a promotion or delisting is done (release.mjs, promote.mjs, delist.mjs).
 */
export function outcome(
  log: string,
): { state: "done" | "awaiting_review"; version: string | null } | { state: "unchanged" } {
  if (/^==> nothing changed/m.test(log)) return { state: "unchanged" };
  const staged = /^==> staged(?: (\S+?))?:/m.exec(log);
  if (staged) return { state: "awaiting_review", version: staged[1] ?? null };
  return { state: "done", version: /^==> (?:released|promoted) (\S+?):/m.exec(log)?.[1] ?? null };
}

/** What a staged release left in its run's directory for promote.mjs; null when it left nothing. */
export async function readStaged(id: string): Promise<unknown> {
  const dir = runDir(id);
  if (!dir) return null;
  const text = await readFile(join(dir, "staged.json"), "utf8").catch(() => null);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function failureReason(log: string, exitCode: number): string {
  const lines = log.trim().split("\n");
  // The first, because each step that fails is followed by release.mjs saying that it exited.
  const said = lines.find((line) => line.startsWith("error: "));
  return said ? said.slice("error: ".length) : `the release exited ${exitCode}`;
}
