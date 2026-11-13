#!/usr/bin/env node
// make manager-publish / manager-gc. Everything comes from the repo-root .env or the environment
// (which wins); nothing prompts, so a scheduled job can run the same command later.
//
//   node scripts/manager/cli.mjs publish [--dry-run] [--present] [--allow-removals]
//   node scripts/manager/cli.mjs gc [--dry-run]
//   node scripts/manager/cli.mjs addon <path/to/Spoken-x.y.z.zip> [--dry-run]
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { managerFolders } from "../lib/packs.mjs";
import { errorText, publishFromEnv, signingKeyFromEnv } from "./channel.mjs";
import { gc } from "./gc.mjs";
import { loadHashCache, saveHashCache } from "./manifest.mjs";
import { publishAddon } from "./publish-addon.mjs";
import { r2Store } from "./store.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../dist");
const [command, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const onlyPresent = flags.includes("--present");
const allowRemovals = flags.includes("--allow-removals");

try {
  if (command !== "publish" && command !== "gc" && command !== "addon") throw new Error("usage: cli.mjs publish|gc|addon [--dry-run] [--present] [--allow-removals]");
  await loadEnv();
  if (command === "addon") {
    const zipPath = flags.find((flag) => !flag.startsWith("--"));
    await publishAddon({ store: r2Store(process.env), signingKey: signingKeyFromEnv(), zipPath, dryRun });
  } else if (command === "publish") {
    const cacheFile = join(DIST, ".manager-hashes.json");
    const cache = loadHashCache(cacheFile);
    try {
      await publishFromEnv({ packs: managerFolders(), distDir: DIST, cache, dryRun, onlyPresent, allowRemovals });
    } finally {
      // Without dist/ there is nothing to cache, and the write would hide publish's own error.
      if (existsSync(DIST)) saveHashCache(cacheFile, cache);
    }
  } else {
    await gc({ store: r2Store(process.env), signingKey: signingKeyFromEnv(), dryRun });
  }
} catch (err) {
  console.error(errorText(err));
  process.exit(1);
}
