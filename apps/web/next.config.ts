import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

import { discordRedirects } from "./src/lib/discord";
import { localeRedirects, localeRewrites } from "./src/lib/locale-routes";
import { sectionRedirects } from "./src/lib/section-routes";

// The monorepo root, two levels up from apps/web/.
const repoRoot = path.resolve(__dirname, "..", "..");

// THE REPO-ROOT .env, which Next does not load on its own: it reads .env* from the app
// directory only, and the shared credentials -- DATABASE_URL, the CurseForge token, the
// vmangos MySQL -- were lifted out of the per-pipeline copies into one file at the root.
// Without this the site would need its own second copy of DATABASE_URL, which is the
// duplication the lift removed.
//
// Next has already loaded .env.local by the time this file runs, so an app-level setting
// wins: assigning only what is unset is what makes .env.local the override it reads as.
//
// Dev and build only. The standalone bundle never executes this file; production takes
// the same variables from the droplet's shared/app.env, through ecosystem.config.js.
const rootEnv = path.join(repoRoot, ".env");
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

// The Spoken release this checkout is, for the report pages' "might already be fixed": read
// at build, since the standalone bundle carries no addons/ to read it from at runtime.
const spokenToc = path.join(repoRoot, "addons", "Spoken", "Spoken.toc");
const spokenVersion = fs.existsSync(spokenToc)
  ? (fs.readFileSync(spokenToc, "utf8").match(/^## Version:\s*(\S+)/m)?.[1] ?? "")
  : "";

const config: NextConfig = {
  env: { NEXT_PUBLIC_SPOKEN_VERSION: spokenVersion },

  // The corpus and the audio store are read at runtime through node:fs, never bundled,
  // so they need no asset config. See src/lib/paths.ts for how they are located.

  // CI ships the build to a droplet that carries no toolchain.
  output: "standalone",

  // THE MONOREPO ROOT, not __dirname. This used to be confined to the app so tracing
  // would not walk the Python side of the repo, and that stopped working the moment
  // pnpm workspaces hoisted node_modules to the repo root: everything the bundle needs
  // then sits OUTSIDE the tracing root, and standalone shipped without `next` at all.
  // The bundle booted in CI and died with "Cannot find module 'next'".
  //
  // The cost is the layout: standalone lays out from the tracing root, so server.js
  // lands at apps/web/server.js rather than at the top. The workflow, activate.sh
  // and pm2's `script` all name that path.
  outputFileTracingRoot: repoRoot,

  // `pg` stays a real require rather than being bundled. The places pipeline's db.mjs reaches
  // for it too, and two copies in one process would each install their own type parsers.
  serverExternalPackages: ["pg"],

  // AND THE EXCLUDES THAT HAVE TO COME WITH IT. Widening the root re-opened exactly what
  // the narrow one was set to prevent. Next's tracer statically evaluates the
  // path.resolve() in src/lib/paths.ts, resolves it to a real directory, and pulls the
  // whole thing in: the first build after the change traced 2,741 files and 127 MB --
  // the Python virtualenv, .pytest_cache, and pipelines/quests/.env, which holds the
  // ElevenLabs key and the database password. A release bundle is rsynced to the
  // droplet, so that is a credential leak and not merely weight. With these excludes the
  // bundle is 4.6 MB.
  //
  // THE GLOBS ARE RELATIVE TO THIS DIRECTORY, NOT TO THE TRACING ROOT. That is not what
  // the option's name suggests and it fails silently: "pipelines/**" matches nothing and
  // excludes nothing, which is how the leak survived its first fix. Hence "../../".
  //
  // The corpus and the voice config are excluded here too, deliberately. They still
  // reach the droplet: the deploy workflow copies them into the release by glob, so a
  // rollback moves data and code together. Tracing them in as well would ship them twice
  // and let a stale copy win.
  // pipelines/quests, NOT pipelines/**. The places half of that directory is compiled INTO
  // this bundle -- lib/places/tools.ts imports it, webpack follows those imports, and
  // excluding it here would exclude nothing webpack had already pulled in while making the
  // exclusion list read as though the whole pipelines tree were out. The Python side is what
  // has to stay out, and for a reason worth repeating: its .env holds the ElevenLabs key and
  // the database password, and a release bundle is rsynced to a droplet.
  // The language in the URL: a bare path is English. See src/lib/locale-routes.ts, and for
  // why this is config and not middleware.
  // The old section addresses first, so /enUS/zones/... lands on /places/... in two hops
  // rather than missing both. See src/lib/section-routes.ts.
  //
  // CASE-SENSITIVE, because LANG_SHAPE tells enUS from npcs by case, and Next matches rewrites
  // and redirects case-insensitively unless told otherwise: every four-letter page would
  // look like a language and be left unrewritten. Page routes themselves already are.
  experimental: { caseSensitiveRoutes: true },
  async redirects() {
    return [...discordRedirects, ...sectionRedirects, ...localeRedirects];
  },
  async rewrites() {
    return { beforeFiles: localeRewrites, afterFiles: [], fallback: [] };
  },

  outputFileTracingExcludes: {
    "*": [
      // THE ROOT .env. It sits at the tracing root itself, holds every shared credential,
      // and a release bundle is rsynced to the droplet -- the same leak pipelines/quests
      // was excluded for, one directory up.
      "../../.env",
      "../../pipelines/quests/**",
      "../../addons/**",
      "../../publishers/**",
      "../../deploy/**",
      "../../dist/**",
      "../../docs/**",
      "../../make/**",
      "../../scripts/**",
      "../../tests/**",
    ],
  },
};

export default config;
