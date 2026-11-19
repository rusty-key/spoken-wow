// A language's quests packs in dist/ for the Manager channel, from pointers to the Oggs, so with no
// transcode and no zip. `cli-main.py build` makes them, so zips and the channel share one definition
// of a module.
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { BASE_LOCALE, isClientLocale } from "../../pipelines/lib/locales.mjs";
import { tocExtra } from "./stage-pack.mjs";

// The changelog lists its newest section first.
export function englishVersion(changelog) {
  const version = /^## ([0-9.]+) — Spoken Quests Audio/m.exec(changelog)?.[1];
  if (!version) throw new Error("no Spoken Quests Audio section in docs/quests/CHANGELOG.md");
  return version;
}

/**
 * Each of the plan's folders (release-pack.mjs) with the arguments of its `cli-main.py build`, past
 * its store and dist. `changelogVersion` is English's, for a folder the plan gives no version;
 * `badge` says whether the language has a badged icon, without which a plan whose badge is
 * optional wears English's mark.
 */
export function buildArgs(lang, plan, { changelogVersion = null, localeText = null, badge = true }) {
  const extra = tocExtra(plan.toc).flatMap(([key, value]) => ["--toc-extra", `${key}=${value}`]);
  return plan.folders.map(({ folder, pack, title, version }) => ({
    folder,
    args: [
      "--module", folder,
      "--pack", pack,
      "--version", version ?? changelogVersion,
      // With no title the build keeps English's .toc, which names no language.
      ...(title === null ? [] : ["--module-title", title, "--language", lang]),
      ...(plan.badgeOptional && !badge ? ["--icon-language", BASE_LOCALE] : []),
      ...extra,
      // The gossip text is --language's.
      ...(title !== null && localeText && pack === "gossip" ? ["--locale-text", localeText] : []),
    ],
  }));
}

/** `plan` is releasePlan's (release-pack.mjs). Each step inherits the release's database (release.mjs). */
export async function questsSteps(lang, { root, plan, run }) {
  const quests = join(root, "pipelines/quests");
  const english = lang === BASE_LOCALE;
  const store = english ? join(quests, "audio") : join(root, "build/quests", lang, "audio");
  const localeText = !english && isClientLocale(lang) ? join(root, "build/quests", lang, "locale-text.json.gz") : null;
  const version = plan.folders.some((p) => p.version === null)
    ? englishVersion(await readFile(join(root, "docs/quests/CHANGELOG.md"), "utf8"))
    : null;
  const badge = existsSync(join(quests, "assets/icon", `spoken-quests-${lang}.tga`));
  const venv = join(quests, ".venv/bin/python");
  const env = {
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
    ...buildArgs(lang, plan, { changelogVersion: version, localeText, badge }).map(({ folder, args }) => [
      `build ${folder}`,
      () => python(["build", "--store", store, "--dist", join(root, "dist"), ...args]),
    ]),
  ];
}
