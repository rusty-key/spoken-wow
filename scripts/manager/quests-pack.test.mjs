import assert from "node:assert/strict";
import { test } from "node:test";

import { managerFolders, packsFor } from "../lib/packs.mjs";
import { buildArgs, englishVersion } from "./quests-pack.mjs";

test("English's version is the newest audio section of the changelog", () => {
  const changelog = "## 9.0.0\n\n## 2.3.0 — Spoken Quests Audio\n\n## 2.2.0 — Spoken Quests Audio\n";
  assert.equal(englishVersion(changelog), "2.3.0");
  assert.throws(() => englishVersion("## 9.0.0\n"), /no Spoken Quests Audio section/);
});

const foldersOf = (lang) => managerFolders().filter((p) => p.section === "quests" && p.lang === lang).map((p) => p.folder);

test("English builds its four folders, each its own slice, under one version", () => {
  const builds = buildArgs("enUS", foldersOf("enUS"), { version: "2.3.0" });
  assert.deepEqual(builds.map(({ args }) => args[args.indexOf("--pack") + 1]).sort(), ["alliance", "gossip", "horde", "shared"]);
  for (const { folder, args } of builds) {
    assert.deepEqual(args, ["--module", folder, "--pack", args[args.indexOf("--pack") + 1], "--version", "2.3.0"]);
  }
});

test("every language builds English's four folders from their pages, its gossip text with Gossip", () => {
  for (const lang of ["deDE", "esES", "esMX", "frFR", "itIT", "koKR", "ptBR", "ruRU", "zhCN", "zhTW"]) {
    const pages = packsFor("quests", lang);
    const builds = buildArgs(lang, foldersOf(lang), { localeText: "/tmp/text.json.gz" });
    assert.deepEqual(builds.map(({ folder }) => folder), ["Alliance", "Horde", "Shared", "Gossip"].map((side) => `SpokenQuestsAudio${side}_${lang}`));
    for (const { folder, args } of builds) {
      const page = pages.find((p) => p.folder === folder);
      assert.deepEqual(args, [
        "--module", folder,
        "--pack", page.pack,
        "--version", page.version,
        "--module-title", page.name,
        "--language", lang,
        ...(page.pack === "gossip" ? ["--locale-text", "/tmp/text.json.gz"] : []),
      ]);
    }
  }
});

test("a folder with no page is an error, not a pack built from nothing", () => {
  assert.throws(() => buildArgs("frFR", ["SpokenQuestsAudio_nope"], {}), /no quests page/);
});

const derived = (lang, toc) => ({
  folders: ["Alliance", "Horde", "Shared", "Gossip"].map((side) => ({
    folder: `SpokenQuestsAudio${side}_${lang}`, section: "quests", lang, pack: side.toLowerCase(), title: `T ${side}`,
  })),
  version: "1.0.0",
  toc,
});

test("a derived pack builds from its own titles and keys, wearing English's mark without a badge", () => {
  const plan = derived("jaJP", { languageName: "Japanese", languageNative: "日本語" });
  const builds = buildArgs("jaJP", plan.folders.map((p) => p.folder), { derived: plan, badge: false });
  assert.deepEqual(builds[0].args, [
    "--module", "SpokenQuestsAudioAlliance_jaJP",
    "--pack", "alliance",
    "--version", "1.0.0",
    "--module-title", "T Alliance",
    "--language", "jaJP",
    "--icon-language", "enUS",
    "--toc-extra", "X-Spoken-LanguageName=Japanese",
    "--toc-extra", "X-Spoken-LanguageNative=日本語",
  ]);
});

test("a second team's derived pack keeps its language's badge and gossip text", () => {
  const plan = derived("deDE", { team: "stimmen", teamName: "Stimmen" });
  const builds = buildArgs("deDE", plan.folders.map((p) => p.folder), { derived: plan, badge: true, localeText: "text.json.gz" });
  assert.deepEqual(builds[3].args, [
    "--module", "SpokenQuestsAudioGossip_deDE",
    "--pack", "gossip",
    "--version", "1.0.0",
    "--module-title", "T Gossip",
    "--language", "deDE",
    "--toc-extra", "X-Spoken-Team=stimmen",
    "--toc-extra", "X-Spoken-TeamName=Stimmen",
    "--locale-text", "text.json.gz",
  ]);
});
