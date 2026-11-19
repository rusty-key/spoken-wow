#!/usr/bin/env node
// make manager-publish / manager-gc, and the site's promote and delist runs (release-job.mjs).
// Everything comes from the repo-root .env or the environment (which wins); nothing prompts, so a
// scheduled job can run the same command later.
//
//   node scripts/manager/cli.mjs publish [--dry-run] [--present] [--allow-removals]
//   node scripts/manager/cli.mjs gc [--dry-run]
//   node scripts/manager/cli.mjs addon <path/to/Spoken-x.y.z.zip> [--dry-run]
//   node scripts/manager/cli.mjs promote <staged.json>
//   node scripts/manager/cli.mjs delist <section> <lang> --team=<slug>
//
// promote lists a staged release once a site owner approves it: what `release.mjs --stage` wrote.
// Its last line is `==> promoted <version>: <folders>`. delist takes a team's pack in one section
// and language off the channel: every folder the team's pack can have leaves both indexes, and its
// manifests and blobs stay. Its last line is `==> delisted <folders>`, or `==> nothing to delist`
// when no index listed any of them. DATABASE_URL (or a checkout's LOCAL_DB) names the team's database.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { managerFolders, SECTIONS } from "../lib/packs.mjs";
import { errorText, fromEnv, publishFromEnv } from "./channel.mjs";
import { gc } from "./gc.mjs";
import { loadHashCache, saveHashCache } from "./manifest.mjs";
import { publishAddon } from "./publish-addon.mjs";
import { delist, promote } from "./publish.mjs";
import { teamPackFolders } from "./release-team.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../dist");
const COMMANDS = ["publish", "gc", "addon", "promote", "delist"];
const [command, ...flags] = process.argv.slice(2);
const args = flags.filter((flag) => !flag.startsWith("--"));
const dryRun = flags.includes("--dry-run");
const onlyPresent = flags.includes("--present");
const allowRemovals = flags.includes("--allow-removals");

async function teamFolders(section, lang, slug) {
  const db = new pg.Client({ connectionString: process.env.LOCAL_DB || process.env.DATABASE_URL });
  await db.connect();
  try {
    return await teamPackFolders(db, section, lang, slug);
  } finally {
    await db.end();
  }
}

try {
  if (!COMMANDS.includes(command)) throw new Error(`usage: cli.mjs ${COMMANDS.join("|")} [--dry-run] [--present] [--allow-removals]`);
  await loadEnv();
  if (command === "addon") {
    await fromEnv(publishAddon, { zipPath: args[0], dryRun });
  } else if (command === "publish") {
    const cacheFile = join(DIST, ".manager-hashes.json");
    const cache = loadHashCache(cacheFile);
    try {
      await publishFromEnv({ packs: managerFolders(), distDir: DIST, cache, dryRun, onlyPresent, allowRemovals });
    } finally {
      // Without dist/ there is nothing to cache, and the write would hide publish's own error.
      if (existsSync(DIST)) saveHashCache(cacheFile, cache);
    }
  } else if (command === "promote") {
    if (!args[0]) throw new Error("usage: cli.mjs promote <staged.json>");
    const staged = JSON.parse(await readFile(args[0], "utf8"));
    const { promoted } = await fromEnv(promote, { staged });
    console.log(`==> promoted${staged.version ? ` ${staged.version}` : ""}: ${promoted.join(", ")}`);
  } else if (command === "delist") {
    const [section, lang] = args;
    const slug = flags.find((flag) => flag.startsWith("--team="))?.slice("--team=".length);
    if (!SECTIONS.includes(section) || !lang || !slug) throw new Error("usage: cli.mjs delist <section> <lang> --team=<slug>");
    const { delisted } = await fromEnv(delist, { folders: await teamFolders(section, lang, slug) });
    console.log(delisted.length > 0 ? `==> delisted ${delisted.join(", ")}` : "==> nothing to delist: no index listed them");
  } else {
    await fromEnv(gc, { dryRun });
  }
} catch (err) {
  console.error(errorText(err));
  process.exit(1);
}
