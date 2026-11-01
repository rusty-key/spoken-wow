#!/usr/bin/env node
// One section and language onto the Manager channel, with no clips on this machine and no zip:
// pointers for the clips, the pack's generated files from the database, then the publish.
//
//   node scripts/manager/release.mjs <places|readables|bosses> <lang> [--dry-run] [--allow-removals] [--stage-only]
//
// DATABASE_URL names the database; a checkout's LOCAL_DB wins for the steps that read it. The
// channel's keys come as for cli.mjs. Each step prints `==> step n/m`, then its own progress.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { parseFrontmatter, forStore } from "../lib/frontmatter.mjs";
import { findPack, managerFolders, PUBLISHERS_DIR } from "../lib/packs.mjs";
import { errorText, publishFromEnv } from "./channel.mjs";
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
if (!LOOKUPS[section] || !/^[a-z]{2}[A-Z]{2}$/.test(lang ?? "")) {
  console.error("usage: release.mjs <places|readables|bosses> <lang> [--dry-run] [--allow-removals] [--stage-only]");
  process.exit(2);
}
const stageOnly = flags.includes("--stage-only");

function run(script, args = []) {
  const env = {
    ...process.env,
    LOCAL_DB: process.env.LOCAL_DB || process.env.DATABASE_URL,
    SPOKEN_CLIP_POINTERS: "1",
    SPOKEN_PLACES_LANG: lang,
  };
  const { status, error } = spawnSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env, stdio: "inherit" });
  if (error) throw error;
  if (status !== 0) throw new Error(`${script} exited ${status}`);
}

try {
  await loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.SPOKEN_ARCHIVE_URL) throw new Error("SPOKEN_ARCHIVE_URL is not set");
  const pack = findPack(section, lang);
  const folders = managerFolders().filter((p) => p.folder === pack.folder);
  if (folders.length === 0) throw new Error(`${pack.folder} is not on the Manager channel: its page has no manager: true`);

  const lookups = LOOKUPS[section](lang);
  const steps = [
    ["clip pointers", () => run("scripts/audio/sounds.mjs", [`--lang=${lang}`, section])],
    ...lookups.map(([name, script, ...args]) => [name, () => run(script, args)]),
    ["the pack's folder", async () => {
      const page = keepsCommittedFolder(section, lang) ? null : parseFrontmatter(await readFile(join(PUBLISHERS_DIR, pack.page), "utf8"), pack.page);
      const staged = await stagePack(section, lang, { root: ROOT, pack, readme: page && forStore(page.body, "curseforge") });
      console.log(`${staged.folder} ${staged.version}`);
    }],
    ...(stageOnly ? [] : [["publish", () => publishFromEnv({
      packs: folders,
      distDir: join(ROOT, "dist"),
      cache: new Map(),
      dryRun: flags.includes("--dry-run"),
      allowRemovals: flags.includes("--allow-removals"),
    })]]),
  ];
  for (const [i, [name, work]] of steps.entries()) {
    console.log(`==> step ${i + 1}/${steps.length}: ${name}`);
    await work();
  }
  console.log("==> done");
} catch (error) {
  console.error(errorText(error));
  process.exit(1);
}
