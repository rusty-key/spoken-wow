import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { seedDatabase } from "../../pipelines/lib/test-db.mjs";
import { englishFolder, loadPacks } from "../lib/packs.mjs";
import { buildArgs } from "./quests-pack.mjs";
import { needsTeamReleases, releasePlan } from "./release-pack.mjs";
import { stagePack } from "./stage-pack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
// Each page pack as master staged it, before teams released: release.golden.json.
const GOLDEN = JSON.parse(readFileSync(join(HERE, "release.golden.json"), "utf8"));
const ICONS = {
  places: (lang) => `pipelines/places/assets/spoken-zones-${lang}.tga`,
  bosses: (lang) => `pipelines/bosses/assets/spoken-bosses-${lang}.tga`,
  readables: (lang) => `pipelines/readables/assets/spoken-books-${lang}.tga`,
};

const privileged = (lang) => ({
  id: "0b7e6a3c-1d2f-4a5b-8c9d-0e1f2a3b4c5d", slug: "x", name: "X", official: true, privileged: true,
  language: { code: lang, name: "X", native: "X", client: true },
});

/** The page pack's .toc as release.mjs stages it, over the committed English folder. */
async function stagedToc(section, lang, plan) {
  const root = mkdtempSync(join(tmpdir(), "golden-"));
  const source = englishFolder(section);
  cpSync(join(REPO, "addons", source, `${source}.toc`), join(root, "addons", source, `${source}.toc`));
  const work = lang === "enUS" ? join(root, "addons", source) : join(root, "build", section, lang);
  mkdirSync(join(work, "Sounds"), { recursive: true });
  mkdirSync(join(work, "Data"), { recursive: true });
  writeFileSync(join(work, "Data/Sounds.lua"), "");
  const icon = ICONS[section](lang);
  if (existsSync(join(REPO, icon))) cpSync(join(REPO, icon), join(root, icon));
  const staged = await stagePack(section, lang, { root, plan, readme: null });
  return { version: staged.version, toc: readFileSync(join(root, "dist", staged.folder, `${staged.folder}.toc`), "utf8") };
}

test("every page pack stages as it did before teams released", async () => {
  const pages = loadPacks().filter((p) => p.manager);
  assert.equal(GOLDEN.length, pages.length);
  for (const was of GOLDEN) {
    const plan = releasePlan(was.section, was.lang, privileged(was.lang));
    assert.deepEqual(plan.folders.map((p) => p.team), plan.folders.map(() => null), `${was.section} ${was.lang}`);
    assert.deepEqual(plan.toc, {}, `${was.section} ${was.lang}`);
    assert.deepEqual(plan.folders.map(({ folder, section, lang }) => ({ folder, section, lang })), was.folders, `${was.section} ${was.lang}`);
    if (was.section === "quests") {
      const builds = buildArgs(was.lang, plan, { changelogVersion: "9.9.9", localeText: "LOCALE_TEXT" });
      assert.deepEqual(builds, was.builds, `${was.section} ${was.lang}`);
    } else {
      assert.deepEqual(await stagedToc(was.section, was.lang, plan), { version: was.version, toc: was.toc }, `${was.section} ${was.lang}`);
    }
  }
});

test("a page pack's README is its page's, but English readables keep their folder's", () => {
  assert.equal(releasePlan("places", "deDE", privileged("deDE")).readmePage, loadPacks().find((p) => p.section === "places" && p.lang === "deDE").page);
  assert.equal(releasePlan("readables", "enUS", privileged("enUS")).readmePage, null);
  assert.equal(releasePlan("quests", "deDE", privileged("deDE")).readmePage, null);
});

test("a quests folder with no page is an error, not a pack built from nothing", () => {
  const packs = loadPacks().filter((p) => !(p.section === "quests" && p.lang === "frFR" && p.pack === "horde"));
  assert.throws(() => releasePlan("quests", "frFR", privileged("frFR"), packs), /SpokenQuestsAudioHorde_frFR has no quests page for frFR/);
});

test("a second team's pack is derived from English's folders, with the team's slug and name", () => {
  const team = {
    ...privileged("deDE"), slug: "stimmen", name: "Stimmen", official: false, privileged: false,
    language: { code: "deDE", name: "German", native: "Deutsch", client: true },
  };
  assert.deepEqual(releasePlan("places", "deDE", team), {
    folders: [{
      folder: "SpokenPlacesAudio_deDE_stimmen", section: "places", lang: "deDE", pack: null,
      title: "Spoken German Audio: Places (Stimmen)", version: "1.0.0", team: { slug: "stimmen", name: "Stimmen", official: false },
    }],
    toc: { team: "stimmen", teamName: "Stimmen" },
    readmePage: null,
    badgeOptional: true,
  });
});

test("a new language's own team builds plain folders, which name the language", () => {
  const team = { ...privileged("jaJP"), language: { code: "jaJP", name: "Japanese", native: "日本語", client: false } };
  const plan = releasePlan("quests", "jaJP", team);
  assert.deepEqual(plan.folders.map((p) => [p.folder, p.pack, p.title]), [
    ["SpokenQuestsAudioAlliance_jaJP", "alliance", "Spoken Japanese Audio: Quests - Alliance"],
    ["SpokenQuestsAudioHorde_jaJP", "horde", "Spoken Japanese Audio: Quests - Horde"],
    ["SpokenQuestsAudioShared_jaJP", "shared", "Spoken Japanese Audio: Quests - Shared"],
    ["SpokenQuestsAudioGossip_jaJP", "gossip", "Spoken Japanese Audio: Gossip"],
  ]);
  assert.deepEqual(plan.toc, { languageName: "Japanese", languageNative: "日本語" });
  // Official and holding the plain space: listed with no team, so no label and no gate.
  assert.ok(plan.folders.every((p) => p.version === "1.0.0" && p.team === null));
  assert.equal(needsTeamReleases(plan), false);
});

test("a page pack of a privileged team that is not official lists its team, which the gate holds", () => {
  const team = { ...privileged("deDE"), slug: "stimmen", name: "Stimmen", official: false };
  for (const section of ["places", "quests"]) {
    const plan = releasePlan(section, "deDE", team);
    const plain = releasePlan(section, "deDE", privileged("deDE"));
    assert.deepEqual(plan.folders.map(({ team, ...rest }) => rest), plain.folders.map(({ team, ...rest }) => rest), section);
    assert.ok(plan.folders.every((p) => p.team?.slug === "stimmen" && p.team.official === false), section);
    assert.equal(needsTeamReleases(plan), true, section);
  }
  assert.equal(needsTeamReleases(releasePlan("places", "deDE", privileged("deDE"))), false);
});

test("an official second team's pack still lists its team, for its suffixed folder", () => {
  const team = { ...privileged("deDE"), slug: "stimmen", name: "Stimmen", privileged: false };
  const plan = releasePlan("places", "deDE", team);
  assert.deepEqual(plan.folders.map((p) => [p.folder, p.team]), [
    ["SpokenPlacesAudio_deDE_stimmen", { slug: "stimmen", name: "Stimmen", official: true }],
  ]);
  assert.equal(needsTeamReleases(plan), true);
});

// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one.
const seed = seedDatabase();
let lang;
let second;
before(() => {
  if (!seed) return;
  lang = seed.language();
  seed.team(lang, { privileged: true });
  second = seed.team(lang, { privileged: false, official: false });
});
after(() => seed?.cleanup());

test("a derived pack is refused before any step where team releases are not open", { skip: seed ? false : "DATABASE_URL is not set" }, () => {
  const run = spawnSync(process.execPath, [join(HERE, "release.mjs"), "places", lang, `--team=${second.slug}`, "--stage-only"], {
    cwd: REPO,
    env: { ...process.env, DATABASE_URL: seed.url, LOCAL_DB: seed.url, SPOKEN_ARCHIVE_URL: "https://archive.invalid/", SPOKEN_TEAM_RELEASES: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /team releases are not open here: set SPOKEN_TEAM_RELEASES=1 in app.env to open them/);
  assert.doesNotMatch(run.stdout, /==> step/);
});

// Stands in for every step's child process: records the database each would have read, and runs none.
const RECORD_STEPS = `
import { appendFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
const child = createRequire(import.meta.url)("node:child_process");
child.spawnSync = (command, args, { env }) => {
  appendFileSync(process.env.STEP_LOG, JSON.stringify({ args, LOCAL_DB: env.LOCAL_DB, DATABASE_URL: env.DATABASE_URL }) + "\\n");
  return { status: 0 };
};
syncBuiltinESMExports();
`;

test("the team and every step come from one database when LOCAL_DB and DATABASE_URL differ", { skip: seed ? false : "DATABASE_URL is not set" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "release-db-"));
  const stub = join(dir, "record-steps.mjs");
  writeFileSync(stub, RECORD_STEPS);
  const log = join(dir, "steps.jsonl");
  const run = spawnSync(process.execPath, ["--import", stub, join(HERE, "release.mjs"), "places", lang, "--stage-only"], {
    cwd: REPO,
    env: {
      ...process.env,
      LOCAL_DB: seed.url,
      DATABASE_URL: "postgres://nobody@127.0.0.1:1/elsewhere",
      SPOKEN_ARCHIVE_URL: "https://archive.invalid/",
      STEP_LOG: log,
    },
    encoding: "utf8",
  });
  // The team was read, so from LOCAL_DB: nothing listens where DATABASE_URL points.
  assert.match(run.stdout, /==> step 1\/5: clip pointers/, run.stderr);
  const steps = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(steps.map(({ args }) => args[0].slice(REPO.length + 1)), [
    "scripts/audio/sounds.mjs",
    "pipelines/places/tools/voice/export-manifest.mjs",
    "pipelines/places/tools/voice/build-lookup.mjs",
    "pipelines/places/tools/voice/validate-audio.mjs",
  ]);
  for (const step of steps) assert.deepEqual([step.LOCAL_DB, step.DATABASE_URL], [seed.url, seed.url], step.args[0]);
});
