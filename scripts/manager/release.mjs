#!/usr/bin/env node
// One section and language onto the Manager channel, with no clips on this machine and no zip:
// pointers for the clips, the pack's generated files from the database, then the publish.
//
//   node scripts/manager/release.mjs <quests|places|readables|bosses> <lang> [--team=<slug>] [--bump=patch|minor|major] [--dry-run] [--allow-removals] [--stage-only]
//
// --team names the team the release builds for, which the site passes; without it, the
// language's privileged team. Every step reads that team's live takes (SPOKEN_RELEASE_TEAM,
// pipelines/lib/release-team.mjs).
//
// DATABASE_URL names the database; a checkout's LOCAL_DB wins for the steps that read it. The
// channel's keys come as for cli.mjs. Each step prints `==> step n/m`, then its own progress, and
// the last line says what came of it: `==> released <version>` or `==> nothing changed`.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { parseFrontmatter, forStore } from "../lib/frontmatter.mjs";
import { PUBLISHERS_DIR } from "../lib/packs.mjs";
import { errorText, publishFromEnv } from "./channel.mjs";
import { BUMPS } from "./pack-version.mjs";
import { questsSteps } from "./quests-pack.mjs";
import { releasePlan } from "./release-pack.mjs";
import { languageNames, releaseTeam } from "./release-team.mjs";
import { keepsCommittedFolder, stagePack } from "./stage-pack.mjs";

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
  console.error("usage: release.mjs <quests|places|readables|bosses> <lang> [--team=<slug>] [--bump=patch|minor|major] [--dry-run] [--allow-removals] [--stage-only]");
  process.exit(2);
}
const stageOnly = flags.includes("--stage-only");
const teamSlug = flags.find((flag) => flag.startsWith("--team="))?.slice("--team=".length) || null;

/** The team and language the release builds for, and every language's names, read before any step runs. */
async function readTeam() {
  const db = new pg.Client({ connectionString: process.env.LOCAL_DB || process.env.DATABASE_URL });
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

function runNode(script, args = []) {
  const env = { LOCAL_DB: process.env.LOCAL_DB || process.env.DATABASE_URL, SPOKEN_CLIP_POINTERS: "1", SPOKEN_PLACES_LANG: lang };
  run(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env, label: script });
}

async function questsPack({ folders, derived }) {
  return { folders, build: await questsSteps(lang, { root: ROOT, folders: folders.map((p) => p.folder), run, derived }) };
}

function soundPack({ folders, pack, derived }) {
  return {
    folders,
    build: [
      ...LOOKUPS[section](lang).map(([name, script, ...args]) => [name, () => runNode(script, args)]),
      ["the pack's folder", async () => {
        // A derived pack has no page: English's README, which the folder already holds, stays.
        const staged = derived
          ? await stagePack(section, lang, {
              root: ROOT,
              pack: { folder: derived.folders[0].folder, name: derived.folders[0].title, version: derived.version, derived: true, toc: derived.toc },
              readme: null,
            })
          : await stagePack(section, lang, { root: ROOT, pack, readme: await pageReadme(pack) });
        console.log(`${staged.folder} ${staged.version}`);
      }],
    ],
  };
}

async function pageReadme(pack) {
  if (keepsCommittedFolder(section, lang)) return null;
  const page = parseFrontmatter(await readFile(join(PUBLISHERS_DIR, pack.page), "utf8"), pack.page);
  return forStore(page.body, "curseforge");
}

try {
  await loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.SPOKEN_ARCHIVE_URL) throw new Error("SPOKEN_ARCHIVE_URL is not set");
  const { team, languages } = await readTeam();
  const plan = releasePlan(section, lang, team);
  // Until a site owner reviews a team's release (docs/platform/TEAMS.md, *Releases*), only a
  // release that signs for the staging channel builds a pack with no page.
  if (plan.derived && process.env.SPOKEN_TEAM_RELEASES !== "1") {
    throw new Error("team releases are not open here: set SPOKEN_TEAM_RELEASES=1 where the release signs for staging");
  }
  // Every step this runs inherits it, so each reads this team's live takes.
  process.env.SPOKEN_RELEASE_TEAM = team.id;
  const { folders, build } = await (quests ? questsPack(plan) : soundPack(plan));

  const dryRun = flags.includes("--dry-run");
  let published = null;
  const steps = [
    ["clip pointers", () => runNode("scripts/audio/sounds.mjs", [`--lang=${lang}`, section])],
    ...build,
    ...(stageOnly ? [] : [["publish", async () => {
      published = await publishFromEnv({
        // A page pack is listed with no team, as one with no label (index-v2.json).
        packs: plan.derived
          ? plan.derived.folders.map(({ folder, section, lang, pack }) => ({
              folder, section, lang, pack, team: { slug: team.slug, name: team.name, official: team.official },
            }))
          : folders,
        languages,
        distDir: join(ROOT, "dist"),
        cache: new Map(),
        bump,
        dryRun,
        allowRemovals: flags.includes("--allow-removals"),
      });
    }]]),
  ];
  for (const [i, [name, work]] of steps.entries()) {
    console.log(`==> step ${i + 1}/${steps.length}: ${name}`);
    await work();
  }
  if (published?.version) console.log(`==> ${dryRun ? "would release" : "released"} ${published.version}: ${published.changed.join(", ")}`);
  else if (published) console.log("==> nothing changed: nothing was released");
  else console.log("==> done");
} catch (error) {
  console.error(errorText(error));
  process.exit(1);
}
