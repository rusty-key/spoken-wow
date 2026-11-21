#!/usr/bin/env node
// What the site starts for a Release press on the droplet: release.mjs in a scratch copy of this
// tree, reporting through files in the run's directory, which every site worker can read.
//
//   node release-tools/scripts/manager/release-job.mjs <run dir>
//
// The site writes job.json there first: { kind, section, lang, bump, team, stage, input } (jobCommand).
// log holds the output, heartbeat's mtime says the job is alive, and exit holds the exit code.
// A staged release leaves staged.json; a promote reads its input from input.json.
import { spawn } from "node:child_process";
import { closeSync, openSync, realpathSync } from "node:fs";
import { cp, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "../../pipelines/lib/env.mjs";

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BEAT_MS = 15_000;
const KEEP_RUNS = 30;

// All app.env gives the job. The site's own secrets have no business in a process that signs
// packs, and SPOKEN_PLACES_MANIFEST there would have the build overwrite the site's manifest.
// release.env is read last and wins: once a team keeps its own bucket, it sets SPOKEN_ARCHIVE_URL
// to the site's /api/archive/, which knows which bucket holds each object (docs/platform/STORAGE.md).
// SPOKEN_TEAM_RELEASES is the site's gate on a team's press, so the job's gate (release.mjs) is the
// same line.
const FROM_APP_ENV = ["DATABASE_URL", "R2_ACCOUNT_ID", "SPOKEN_ARCHIVE_URL", "SPOKEN_TEAM_RELEASES"];

export async function jobEnv(releaseEnvPath, base = process.env) {
  const app = parseEnv(await readFile(join(dirname(releaseEnvPath), "app.env"), "utf8"));
  const env = { PATH: base.PATH, HOME: base.HOME };
  for (const name of FROM_APP_ENV) if (app.has(name)) env[name] = app.get(name);
  return { ...env, ...Object.fromEntries(parseEnv(await readFile(releaseEnvPath, "utf8"))) };
}

export async function pruneRuns(runsDir, keep = KEEP_RUNS) {
  const names = await readdir(runsDir);
  const dated = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(runsDir, name))).mtimeMs })));
  const old = dated.sort((a, b) => b.at - a.at).slice(keep);
  await Promise.all(old.map(({ name }) => rm(join(runsDir, name), { recursive: true, force: true })));
}

function runRelease(script, args, { cwd, env, log }) {
  return new Promise((done) => {
    const out = openSync(log, "a");
    const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ["ignore", out, out] });
    closeSync(out);
    child.on("error", () => done(1));
    child.on("close", (code) => done(code ?? 1));
  });
}

/**
 * The script in scripts/manager a job runs, and its arguments. A release builds and publishes, or
 * with `stage` writes what it staged to staged.json in the run directory, which the site reads once
 * it exits. A promote lists the staged release in input.json; a delist resolves the team's folders
 * itself.
 */
export function jobCommand(runDir, { kind = "release", section, lang, bump = "patch", team = null, stage = false }) {
  if (kind === "promote") return ["cli.mjs", ["promote", join(runDir, "input.json")]];
  if (kind === "delist") return ["cli.mjs", ["delist", section, lang, `--team=${team}`]];
  if (kind !== "release") throw new Error(`no job kind ${kind}`);
  return [
    "release.mjs",
    [section, lang, `--bump=${bump}`, ...(team ? [`--team=${team}`] : []), ...(stage ? [`--stage=${join(runDir, "staged.json")}`] : [])],
  ];
}

/** `job` is job.json as the site wrote it. */
export async function runJob({ runDir, job, env, tools = TOOLS, beatMs = BEAT_MS }) {
  const log = join(runDir, "log");
  const heartbeat = join(runDir, "heartbeat");
  const work = join(runDir, "work");
  const beat = setInterval(() => {
    const now = new Date();
    utimes(heartbeat, now, now).catch(() => {});
  }, beatMs);
  let code = 1;
  try {
    // A copy, so a run starts from nothing the last one left, and a deploy pruning this release
    // cannot pull the files from under it.
    await cp(tools, work, { recursive: true, verbatimSymlinks: true });
    const [script, args] = jobCommand(runDir, job);
    if (job.input != null) await writeFile(join(runDir, "input.json"), JSON.stringify(job.input));
    code = await runRelease(join(work, "scripts/manager", script), args, { cwd: work, env, log });
  } catch (error) {
    await writeFile(log, `error: ${error.message}\n`, { flag: "a" });
  } finally {
    clearInterval(beat);
    await rm(work, { recursive: true, force: true }).catch(() => {});
    // Renamed into place: a worker reading a half-written file would settle on a wrong code.
    await writeFile(`${join(runDir, "exit")}.part`, String(code));
    await rename(`${join(runDir, "exit")}.part`, join(runDir, "exit"));
  }
  return code;
}

// Real paths: through a symlink the two would differ, and the job would exit 0 having done nothing.
if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runDir] = process.argv.slice(2);
  const job = JSON.parse(await readFile(join(runDir, "job.json"), "utf8"));
  const code = await runJob({ runDir, job, env: await jobEnv(process.env.SPOKEN_RELEASE_ENV) });
  await pruneRuns(dirname(runDir)).catch((error) => console.error(`pruning old runs: ${error.message}`));
  process.exit(code);
}
