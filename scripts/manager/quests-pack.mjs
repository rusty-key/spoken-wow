// A language's quests packs in dist/ for the Manager channel, from pointers to the Oggs, so with no
// transcode and no zip. `cli-main.py build` makes them, so zips and the channel share one definition
// of a module.
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { BASE_LOCALE, isClientLocale } from "../../pipelines/lib/locales.mjs";
import { packsFor } from "../lib/packs.mjs";
import { tocExtra } from "./stage-pack.mjs";

// The changelog lists its newest section first.
export function englishVersion(changelog) {
  const version = /^## ([0-9.]+) — Spoken Quests Audio/m.exec(changelog)?.[1];
  if (!version) throw new Error("no Spoken Quests Audio section in docs/quests/CHANGELOG.md");
  return version;
}

/**
 * Each folder with the arguments of its `cli-main.py build`, past its store and dist. `derived` is
 * a pack with no page (scripts/manager/release-pack.mjs), whose folders carry their own titles;
 * `badge` says whether the language has a badged icon, without which a derived pack wears
 * English's mark.
 */
export function buildArgs(lang, folders, { version, localeText, derived = null, badge = true }) {
  if (derived) return derivedArgs(lang, folders, { derived, localeText, badge });
  const packs = packsFor("quests", lang);
  return folders.map((folder) => {
    const pack = packs.find((p) => p.folder === folder);
    if (!pack) throw new Error(`${folder} has no quests page for ${lang}`);
    const common = ["--module", folder, "--pack", pack.pack];
    if (lang === BASE_LOCALE) return { folder, args: [...common, "--version", version] };
    return {
      folder,
      args: [
        ...common,
        "--version", pack.version,
        "--module-title", pack.name,
        "--language", lang,
        ...(localeText && pack.pack === "gossip" ? ["--locale-text", localeText] : []),
      ],
    };
  });
}

function derivedArgs(lang, folders, { derived, localeText, badge }) {
  const extra = tocExtra(derived.toc).flatMap(([key, value]) => ["--toc-extra", `${key}=${value}`]);
  return folders.map((folder) => {
    const pack = derived.folders.find((p) => p.folder === folder);
    if (!pack) throw new Error(`${folder} is not one of the derived pack's folders`);
    return {
      folder,
      args: [
        "--module", folder,
        "--pack", pack.pack,
        "--version", derived.version,
        "--module-title", pack.title,
        "--language", lang,
        ...(badge ? [] : ["--icon-language", BASE_LOCALE]),
        ...extra,
        ...(localeText && pack.pack === "gossip" ? ["--locale-text", localeText] : []),
      ],
    };
  });
}

export async function questsSteps(lang, { root, folders, run, derived = null }) {
  const quests = join(root, "pipelines/quests");
  const english = lang === BASE_LOCALE;
  const store = english ? join(quests, "audio") : join(root, "build/quests", lang, "audio");
  const localeText = !english && isClientLocale(lang) ? join(root, "build/quests", lang, "locale-text.json.gz") : null;
  const version = english && !derived ? englishVersion(await readFile(join(root, "docs/quests/CHANGELOG.md"), "utf8")) : null;
  const badge = existsSync(join(quests, "assets/icon", `spoken-quests-${lang}.tga`));
  const venv = join(quests, ".venv/bin/python");
  const env = {
    DATABASE_URL: process.env.LOCAL_DB || process.env.DATABASE_URL,
    PYTHONPATH: join(quests, "vendor"),
    PYTHONUNBUFFERED: "1",
  };
  const python = (args) => run(existsSync(venv) ? venv : "python3", ["cli-main.py", ...args], { cwd: quests, env, label: `cli-main.py ${args[0]}` });
  return [
    ["export the corpus", () => python(["export-corpus"])],
    ["export the ignore list", () => python(["export-ignores"])],
    ...(localeText
      ? [["export the gossip text", async () => {
          await mkdir(dirname(localeText), { recursive: true });
          python(["export-locale-text", "--lang", lang, "--out", localeText]);
        }]]
      : []),
    ...buildArgs(lang, folders, { version, localeText, derived, badge }).map(({ folder, args }) => [
      `build ${folder}`,
      () => python(["build", "--store", store, "--dist", join(root, "dist"), ...args]),
    ]),
  ];
}
