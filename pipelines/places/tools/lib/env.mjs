// The places pipeline's view of .env.
//
// The reader itself is shared -- pipelines/lib/env.mjs, which loads the repo-root .env
// first and this pipeline's own .env over it, and explains why the shared half was lifted
// out of the three copies that used to drift. This file only binds it to "places" and keeps
// the names the tools here already import.

import { loadEnv, readEnv, requireEnv, pipelineEnvPath } from "../../../lib/env.mjs";

const PIPELINE = "places";

export const ENV_PATH = pipelineEnvPath(PIPELINE);

/**
 * Copy .env into process.env for keys that are not already set.
 *
 * Call it from a CLI entry point, never from a module the explorer bundles: the paths
 * derive from the module's own location, which webpack resolves to the build machine's
 * filesystem. An already-set variable always wins, so an explicit `DATABASE_URL= make ...`
 * still means "use the files".
 */
export function loadEnvFile() {
  return loadEnv(PIPELINE);
}

/** The named key from .env, else the environment, else null. */
export function readEnvKey(name) {
  return readEnv(name, PIPELINE);
}

/** The named key, or an error naming the file it belongs in. */
export function requireEnvKey(name, example) {
  return requireEnv(name, example, PIPELINE);
}
