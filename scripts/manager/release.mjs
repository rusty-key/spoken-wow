#!/usr/bin/env node
// One section and language onto the Manager channel, with no clips on this machine and no zip:
// pointers for the clips, the pack's generated files from the database, then the publish.
//
//   node scripts/manager/release.mjs <quests|places|readables|bosses> <lang> [--bump=patch|minor|major] [--dry-run] [--allow-removals] [--stage-only]
//
// DATABASE_URL names the database; a checkout's LOCAL_DB wins for the steps that read it. The
// channel's keys come as for cli.mjs. Each step prints `==> step n/m`, then its own progress, and
// the last line says what came of it: `==> released <version>` or `==> nothing changed`.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { parseFrontmatter, forStore } from "../lib/frontmatter.mjs";
import { findPack, managerFolders, PUBLISHERS_DIR } from "../lib/packs.mjs";
import { errorText, publishFromEnv } from "./channel.mjs";
import { BUMPS } from "./pack-version.mjs";
import { questsSteps } from "./quests-pack.mjs";
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
  console.error("usage: release.mjs <quests|places|readables|bosses> <lang> [--bump=patch|minor|major] [--dry-run] [--allow-removals] [--stage-only]");
  process.exit(2);
}
const stageOnly = flags.includes("--stage-only");

function run(command, args, { cwd, env, label }) {
  const { status, error } = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  if (error) throw error;
  if (status !== 0) throw new Error(`${label} exited ${status}`);
}

function runNode(script, args = []) {
  const env = { LOCAL_DB: process.env.LOCAL_DB || process.env.DATABASE_URL, SPOKEN_CLIP_POINTERS: "1", SPOKEN_PLACES_LANG: lang };
  run(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env, label: script });
}

async function questsPack() {
  const folders = managerFolders().filter((p) => p.section === section && p.lang === lang);
  return { folders, build: await questsSteps(lang, { root: ROOT, folders: folders.map((p) => p.folder), run }) };
}

function soundPack() {
  const pack = findPack(section, lang);
  return {
    folders: managerFolders().filter((p) => p.folder === pack.folder),
    build: [
      ...LOOKUPS[section](lang).map(([name, script, ...args]) => [name, () => runNode(script, args)]),
      ["the pack's folder", async () => {
        const page = keepsCommittedFolder(section, lang) ? null : parseFrontmatter(await readFile(join(PUBLISHERS_DIR, pack.page), "utf8"), pack.page);
        const staged = await stagePack(section, lang, { root: ROOT, pack, readme: page && forStore(page.body, "curseforge") });
        console.log(`${staged.folder} ${staged.version}`);
      }],
    ],
  };
}

try {
  await loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.SPOKEN_ARCHIVE_URL) throw new Error("SPOKEN_ARCHIVE_URL is not set");
  const { folders, build } = await (quests ? questsPack() : soundPack());
  if (folders.length === 0) throw new Error(`${section} ${lang} is not on the Manager channel: its page has no manager: true`);

  const dryRun = flags.includes("--dry-run");
  let published = null;
  const steps = [
    ["clip pointers", () => runNode("scripts/audio/sounds.mjs", [`--lang=${lang}`, section])],
    ...build,
    ...(stageOnly ? [] : [["publish", async () => {
      published = await publishFromEnv({
        packs: folders,
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
