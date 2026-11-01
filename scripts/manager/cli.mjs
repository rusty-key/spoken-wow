#!/usr/bin/env node
// make manager-publish / manager-gc. Everything comes from the repo-root .env or the environment
// (which wins); nothing prompts, so a scheduled job can run the same command later.
//
//   node scripts/manager/cli.mjs publish [--dry-run] [--present]
//   node scripts/manager/cli.mjs gc [--dry-run]
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { managerFolders, MIN_SPOKEN } from "../lib/packs.mjs";
import { gc } from "./gc.mjs";
import { loadHashCache, saveHashCache } from "./manifest.mjs";
import { latestSpokenRelease, publish } from "./publish.mjs";
import { ConflictError, r2Store } from "./store.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../dist");
const [command, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const onlyPresent = flags.includes("--present");

try {
  if (command !== "publish" && command !== "gc") throw new Error("usage: cli.mjs publish|gc [--dry-run] [--present]");
  await loadEnv();
  const store = r2Store(process.env);
  const signingKey = process.env.SPOKEN_PACKS_SIGNING_KEY;
  if (!signingKey) throw new Error("missing SPOKEN_PACKS_SIGNING_KEY");
  if (command === "publish") {
    const cacheFile = join(DIST, ".manager-hashes.json");
    const cache = loadHashCache(cacheFile);
    try {
      await publish({ store, packs: managerFolders(), distDir: DIST, signingKey, minSpoken: MIN_SPOKEN,
        latestSpoken: await latestSpokenRelease(), cache, dryRun, onlyPresent });
    } finally {
      // Without dist/ there is nothing to cache, and the write would hide publish's own error.
      if (existsSync(DIST)) saveHashCache(cacheFile, cache);
    }
  } else {
    await gc({ store, signingKey, dryRun });
  }
} catch (err) {
  console.error(err instanceof ConflictError
    ? `error: ${err.message} was written by another publish while this one ran; run it again`
    : `error: ${err.message}`);
  process.exit(1);
}
