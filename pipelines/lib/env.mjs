// Reading credentials out of .env, for every pipeline.
//
// Two files, in order: the repo root's .env holds what all three pipelines and the site
// share -- the CurseForge token, the ElevenLabs key, the vmangos MySQL, DATABASE_URL --
// and a pipeline's own .env holds only what is its alone. Before this, each pipeline
// carried its own copy of the shared half; the copies drifted (places held a stale
// ElevenLabs key) and scripts/readables/release.sh had to search all three .env files in turn
// to find the one CurseForge token.
//
// A short reader rather than a dependency, matching this repo's other tools, which have
// none.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root: this file is pipelines/lib/env.mjs. */
export const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const ROOT_ENV_PATH = join(REPO_ROOT, ".env");

/** Where a pipeline's own .env lives. `name` is its folder: "quests", "places" or "readables". */
export function pipelineEnvPath(name) {
  return join(REPO_ROOT, "pipelines", name, ".env");
}

/**
 * The files a pipeline reads, least specific first, so a later one overrides an earlier.
 */
export function envPaths(name) {
  return name ? [ROOT_ENV_PATH, pipelineEnvPath(name)] : [ROOT_ENV_PATH];
}

export function parseEnv(text) {
  const values = new Map();
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, name, raw] = match;
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (value) values.set(name, value);
  }
  return values;
}

async function read(paths) {
  const values = new Map();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const [name, value] of parseEnv(await readFile(path, "utf8"))) values.set(name, value);
  }
  return values;
}

/**
 * Copy the .env files into process.env.
 *
 * An already-set variable wins by default, so an explicit `DATABASE_URL= make ...` still
 * means "use the files" -- make/places.mk's VOICE_DB depends on that, and says so.
 *
 * `override` names the variables the file wins for instead. It exists for the generic
 * names -- MYSQL_PASSWORD and its four neighbours -- that other projects export into the
 * shell: an ambient one turns "connect to the local vmangos" into an access-denied error
 * that reads like a missing dump, which is the mix-up tts_cli/env_vars.py documents having
 * been bitten by and loads its own .env with override=True to prevent.
 *
 * Call it from a CLI entry point, never from a module the explorer bundles: the paths
 * here derive from import.meta.url, which webpack replaces at build time with the build
 * machine's filesystem.
 */
export async function loadEnv(pipeline, { override = [] } = {}) {
  const forced = new Set(override);
  for (const [name, value] of await read(envPaths(pipeline))) {
    if (forced.has(name) || process.env[name] === undefined) process.env[name] = value;
  }
}

/** The vmangos credentials, which both extracts read and other projects export. */
export const MYSQL_VARS = [
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
];

/** The named key from the .env files, else the environment, else null. */
export async function readEnv(name, pipeline) {
  const values = await read(envPaths(pipeline));
  return values.get(name) ?? process.env[name] ?? null;
}

/** The named key, or an error naming the file it belongs in. */
export async function requireEnv(name, example, pipeline) {
  const value = await readEnv(name, pipeline);
  if (value) return value;
  throw new Error(
    `no ${name}.\n` +
      `  Put it in ${ROOT_ENV_PATH} as:  ${name}=${example}\n` +
      "  (.env is gitignored.)",
  );
}
