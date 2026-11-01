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

const LOG_TAIL_BYTES = 8_000;

export type DropletRun = {
  log: string;
  /** Null until the job has finished. */
  exitCode: number | null;
  heartbeatAt: number;
};

/** Quests still encodes, which the droplet is not for. No release.env means Actions, as a way back. */
export function runsOnDroplet(section: string): boolean {
  return section !== "quests" && Boolean(process.env.SPOKEN_RELEASE_ENV);
}

function runDir(id: string): string | null {
  const env = process.env.SPOKEN_RELEASE_ENV;
  return env ? join(dirname(env), "release-runs", id) : null;
}

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export async function startDropletRun(
  run: { id: string; section: string; lang: string },
  spawnFn: Spawn = spawn,
): Promise<void> {
  const dir = runDir(run.id);
  if (!dir) throw new Error("releases on this machine need SPOKEN_RELEASE_ENV set");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "heartbeat"), "");
  await writeFile(join(dir, "log"), "");

  // Resolved now, so the job keeps the release it started from through a symlink swap.
  const tools = realpathSync(join(process.env.SPOKEN_PLACES_ROOT ?? process.cwd(), "release-tools"));
  const log = openSync(join(dir, "log"), "a");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawnFn(
        "setsid",
        // The site keeps the machine's one CPU.
        ["--fork", "nice", "-n", "10", process.execPath, join(tools, "scripts/manager/release-job.mjs"), dir, run.section, run.lang],
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

async function tail(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    const { buffer } = await file.read(Buffer.alloc(length), 0, length, size - length);
    const text = buffer.toString("utf8");
    // A cut line reads as a garbled one.
    return size > length ? text.slice(text.indexOf("\n") + 1) : text;
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
    return { log, exitCode: exit === null ? null : Number(exit), heartbeatAt: beat.mtimeMs };
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

export function failureReason(log: string, exitCode: number): string {
  const lines = log.trim().split("\n");
  const said = lines.findLast((line) => line.startsWith("error: "));
  return said ? said.slice("error: ".length) : `the release exited ${exitCode}`;
}
