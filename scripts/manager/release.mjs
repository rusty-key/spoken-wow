#!/usr/bin/env node
// One section and language onto the Manager channel, with no clips on this machine and no zip:
// pointers for the clips, the pack's generated files from the database, then the publish.
//
//   node scripts/manager/release.mjs <quests|places|readables|bosses> <lang> [--team=<slug>] [--bump=patch|minor|major] [--dry-run] [--allow-removals] [--stage-only] [--stage[=<file>]]
//
// --team names the team the release builds for, which the site passes; without it, the
// language's privileged team. Every step reads that team's live takes (SPOKEN_RELEASE_TEAM,
// pipelines/lib/release-team.mjs).
//
// --stage publishes without listing: blobs and manifests go up, no index changes, and what a
// site owner's approval would list goes to <file> (dist/staged.json without one) for
// `cli.mjs promote`, with the takes the pack was built from (`takes`), which the site's review
// plays. The site stages every release of a team that is not official.
//
// DATABASE_URL names the database; a checkout's LOCAL_DB wins over it. The team and every step
// read that one database, so the takes a step looks up are the team's. The channel's keys come as
// for cli.mjs. Each step prints `==> step n/m`, then its own progress, and the last line says what
// came of it: `==> released <version>`, `==> staged <version>` or `==> nothing changed`.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { parseFrontmatter, forStore } from "../lib/frontmatter.mjs";
import { PUBLISHERS_DIR } from "../lib/packs.mjs";
import { errorText, publishFromEnv } from "./channel.mjs";
import { BUMPS } from "./pack-version.mjs";
import { questsSteps } from "./quests-pack.mjs";
import { needsTeamReleases, releasePlan } from "./release-pack.mjs";
import { languageNames, releaseTeam } from "./release-team.mjs";
import { stagePack, stagedWithTakes } from "./stage-pack.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const LOOKUPS = {
  places: () => [
    ["export manifest", "pipelines/places/tools/voice/export-manifest.mjs"],
    ["lookup", "pipelines/places/tools/voice/build-lookup.mjs"],
    ["validate", "pipelines/places/tools/voice/validate-audio.mjs"],
  ],
  bosses: (lang) => [
    ["lookup", "pipelines/places/tools/bosses/build-lookup.mjs", "--lang", lang],
    ["validate", "pipelines/places/tools/bosses/validate-audio.mjs", "--lang", lang],
  ],
  readables: (lang) => [["lookup", "pipelines/readables/tools/build-lookup.mjs", `--lang=${lang}`]],
};

const [section, lang, ...flags] = process.argv.slice(2);
const quests = section === "quests";
const bump = flags.find((flag) => flag.startsWith("--bump="))?.slice("--bump=".length) ?? "patch";
if ((!quests && !LOOKUPS[section]) || !/^[a-z]{2}[A-Z]{2}$/.test(lang ?? "") || !BUMPS.includes(bump)) {
  console.error("usage: release.mjs <quests|places|readables|bosses> <lang> [--team=<slug>] [--bump=patch|minor|major] [--dry-run] [--allow-removals] [--stage-only] [--stage[=<file>]]");
  process.exit(2);
}
const stageOnly = flags.includes("--stage-only");
const stageFlag = flags.find((flag) => flag === "--stage" || flag.startsWith("--stage="));
const stagedFile = stageFlag ? stageFlag.slice("--stage=".length) || join(ROOT, "dist", "staged.json") : null;
const teamSlug = flags.find((flag) => flag.startsWith("--team="))?.slice("--team=".length) || null;
// What the clip pointers were made from, for a staged release's review.
const selectionFile = join(ROOT, "dist", "selected-takes.json");

/** The team and language the release builds for, and every language's names, read before any step runs. */
async function readTeam() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return { team: await releaseTeam(db, lang, teamSlug), languages: await languageNames(db) };
  } finally {
    await db.end();
  }
}

function run(command, args, { cwd, env, label }) {
  const { status, error } = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  if (error) throw error;
  if (status !== 0) throw new Error(`${label} exited ${status}`);
}

function runNode(script, args = [], extra = {}) {
  const env = { SPOKEN_CLIP_POINTERS: "1", SPOKEN_PLACES_LANG: lang, ...extra };
  run(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env, label: script });
}

function soundSteps(plan) {
  return [
    ...LOOKUPS[section](lang).map(([name, script, ...args]) => [name, () => runNode(script, args)]),
    ["the pack's folder", async () => {
      const staged = await stagePack(section, lang, { root: ROOT, plan, readme: await readmeOf(plan) });
      console.log(`${staged.folder} ${staged.version}`);
    }],
  ];
}

async function readmeOf({ readmePage }) {
  if (readmePage === null) return null;
  const page = parseFrontmatter(await readFile(join(PUBLISHERS_DIR, readmePage), "utf8"), readmePage);
  return forStore(page.body, "curseforge");
}

try {
  await loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.SPOKEN_ARCHIVE_URL) throw new Error("SPOKEN_ARCHIVE_URL is not set");
  // Some steps read LOCAL_DB and some DATABASE_URL: each names the one database, which every step
  // inherits, so the team read here is the one whose takes they look up.
  process.env.LOCAL_DB = process.env.DATABASE_URL = process.env.LOCAL_DB || process.env.DATABASE_URL;
  const { team, languages } = await readTeam();
  const plan = releasePlan(section, lang, team);
  // Only where the site has opened team releases (docs/platform/TEAMS.md, *Releases*) does a
  // release build a pack the Manager labels with its team.
  if (needsTeamReleases(plan) && process.env.SPOKEN_TEAM_RELEASES !== "1") {
    throw new Error("team releases are not open here: set SPOKEN_TEAM_RELEASES=1 in app.env to open them");
  }
  // Every step this runs inherits it, so each reads this team's live takes.
  process.env.SPOKEN_RELEASE_TEAM = team.id;
  const build = quests ? await questsSteps(lang, { root: ROOT, plan, run }) : soundSteps(plan);

  const dryRun = flags.includes("--dry-run");
  let published = null;
  const steps = [
    ["clip pointers", async () => {
      await rm(selectionFile, { force: true });
      await mkdir(dirname(selectionFile), { recursive: true });
      runNode("scripts/audio/sounds.mjs", [`--lang=${lang}`, section], { SPOKEN_SELECTED_TAKES: selectionFile });
    }],
    ...build,
    ...(stageOnly ? [] : [["publish", async () => {
      published = await publishFromEnv({
        packs: plan.folders,
        languages,
        distDir: join(ROOT, "dist"),
        cache: new Map(),
        bump,
        dryRun,
        stage: Boolean(stagedFile),
        allowRemovals: flags.includes("--allow-removals"),
      });
    }]]),
  ];
  for (const [i, [name, work]] of steps.entries()) {
    console.log(`==> step ${i + 1}/${steps.length}: ${name}`);
    await work();
  }
  const staged = published?.staged ? Object.keys(published.staged.packs) : [];
  if (staged.length > 0 && !dryRun) {
    await writeFile(stagedFile, `${JSON.stringify(await stagedWithTakes(published.staged, selectionFile), null, 2)}\n`);
    console.log(`==> staged${published.version ? ` ${published.version}` : ""}: ${staged.join(", ")}`);
  } else if (published?.version) console.log(`==> ${dryRun ? "would release" : "released"} ${published.version}: ${published.changed.join(", ")}`);
  else if (published) console.log("==> nothing changed: nothing was released");
  else console.log("==> done");
} catch (error) {
  console.error(errorText(error));
  process.exit(1);
}
