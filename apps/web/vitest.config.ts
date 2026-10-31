import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

/**
 * Read the .env files the way `next dev` does, root first and .env.local over it.
 *
 * Vitest does not, and history.test.ts needs DATABASE_URL: it exercises the version table
 * against a real Postgres, because the constraints that keep its ordering honest live in the
 * schema rather than in the code. CI sets DATABASE_URL in the job environment, and a real
 * environment variable wins over anything read here.
 *
 * Both files, because DATABASE_URL is shared with the pipelines and lives in the repo root's
 * .env now; next.config.ts loads the same pair in the same order, and .env.local holds only
 * what is the site's alone.
 */
function localEnv(): Record<string, string> {
  const values = new Map<string, string>();

  for (const file of [
    path.resolve(__dirname, "..", "..", ".env"),
    path.resolve(__dirname, ".env.local"),
  ]) {
    if (!fs.existsSync(file)) continue;

    for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const at = line.indexOf("=");
      values.set(line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, ""));
    }
  }

  // A checkout set up to try the R2 archive must not have its tests write to the bucket.
  values.set("SPOKEN_ARCHIVE_STORE", "disk");
  return Object.fromEntries([...values].filter(([key]) => !(key in process.env)));
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: localEnv(),
    /**
     * One test file at a time.
     *
     * The queue tests claim from a real, shared table, and claiming is by definition
     * global - there is no per-run prefix that `claimNext` could respect. Files running in
     * parallel would take each other's jobs and fail perhaps one run in three, which is the
     * worst kind of test failure to own. The suite is small enough that the wall-clock cost
     * is seconds.
     */
    fileParallelism: false,
    // Removes the activity rows a run writes as nobody; see the file for why.
    globalSetup: ["./vitest.activity.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      /**
       * `server-only` resolved the way the server resolves it.
       *
       * The package exports a throwing module by default and an empty one under the
       * `react-server` condition, which is how it turns "imported from a client component"
       * into a build error. Vitest runs in plain node, gets the throwing one, and every
       * server module that imports it - lib/api-key.ts, and everything reaching it - fails
       * to load. Pointed at the same empty module the server condition selects.
       */
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
      // The places pipeline, as tsconfig.json resolves it. Vitest reads neither that file's
      // paths nor next.config.ts's tracing root, so the alias has to be stated twice or a
      // test that touches lib/places cannot load at all.
      "@tools": path.resolve(__dirname, "../../pipelines/places/tools"),
      // The readables pipeline, for the same reason and with the same caveat.
      "@readables-tools": path.resolve(__dirname, "../../pipelines/readables/tools"),
    },
  },
});
