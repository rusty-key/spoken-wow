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
import { releasePlan } from "./release-pack.mjs";
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
  id: "0b7e6a3c-1d2f-4a5b-8c9d-0e1f2a3b4c5d", slug: "x", name: "X", official: true, privileged: true, plain: true,
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
  const staged = await stagePack(section, lang, { root, pack: plan.pack, readme: null });
  return { version: staged.version, toc: readFileSync(join(root, "dist", staged.folder, `${staged.folder}.toc`), "utf8") };
}

test("every page pack stages as it did before teams released", async () => {
  const pages = loadPacks().filter((p) => p.manager);
  assert.equal(GOLDEN.length, pages.length);
  for (const was of GOLDEN) {
    const plan = releasePlan(was.section, was.lang, privileged(was.lang));
    assert.equal(plan.derived, null, `${was.section} ${was.lang}`);
    assert.deepEqual(plan.folders, was.folders, `${was.section} ${was.lang}`);
    if (was.section === "quests") {
      const builds = buildArgs(was.lang, plan.folders.map((p) => p.folder), { version: "9.9.9", localeText: "LOCALE_TEXT" });
      assert.deepEqual(builds, was.builds, `${was.section} ${was.lang}`);
    } else {
      assert.deepEqual(await stagedToc(was.section, was.lang, plan), { version: was.version, toc: was.toc }, `${was.section} ${was.lang}`);
    }
  }
});

test("a second team's pack is derived from English's folders, with the team's slug and name", () => {
  const team = {
    ...privileged("deDE"), slug: "stimmen", name: "Stimmen", official: false, privileged: false, plain: false,
    language: { code: "deDE", name: "German", native: "Deutsch", client: true },
  };
  const plan = releasePlan("places", "deDE", team);
  assert.equal(plan.pack, null);
  assert.deepEqual(plan.folders, [{ folder: "SpokenPlacesAudio_deDE_stimmen", section: "places", lang: "deDE" }]);
  assert.deepEqual(plan.derived, {
    folders: [{ folder: "SpokenPlacesAudio_deDE_stimmen", section: "places", lang: "deDE", pack: null, title: "Spoken German Audio: Places (Stimmen)" }],
    version: "1.0.0",
    toc: { team: "stimmen", teamName: "Stimmen" },
  });
});

test("a new language's own team builds plain folders, which name the language", () => {
  const team = { ...privileged("jaJP"), language: { code: "jaJP", name: "Japanese", native: "日本語", client: false } };
  const plan = releasePlan("quests", "jaJP", team);
  assert.deepEqual(plan.derived.folders.map((p) => [p.folder, p.pack, p.title]), [
    ["SpokenQuestsAudioAlliance_jaJP", "alliance", "Spoken Japanese Audio: Quests - Alliance"],
    ["SpokenQuestsAudioHorde_jaJP", "horde", "Spoken Japanese Audio: Quests - Horde"],
    ["SpokenQuestsAudioShared_jaJP", "shared", "Spoken Japanese Audio: Quests - Shared"],
    ["SpokenQuestsAudioGossip_jaJP", "gossip", "Spoken Japanese Audio: Gossip"],
  ]);
  assert.deepEqual(plan.derived.toc, { languageName: "Japanese", languageNative: "日本語" });
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
  assert.match(run.stderr, /team releases are not open here: set SPOKEN_TEAM_RELEASES=1 where the release signs for staging/);
  assert.doesNotMatch(run.stdout, /==> step/);
});
