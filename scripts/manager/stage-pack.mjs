// A sound pack's folder in dist/, for the Manager channel: what the section's package-audio.sh
// leaves there, without the zip. Its clips may be pointers (scripts/lib/clip-pointer.mjs).
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { BASE_LOCALE } from "../../pipelines/lib/locales.mjs";
import { englishFolder } from "../lib/packs.mjs";

// Whatever a section does differently: its English folder, its languages' badged icons, and the
// .toc lines naming a pack's tier and language, which its Data/Sounds.lua reads back. Readables
// names its language in its .toc only (`languageKey`), as scripts/readables/package-audio.sh does.
const SECTIONS = {
  places: { icon: (lang) => `pipelines/places/assets/spoken-zones-${lang}.tga`, tocPrefix: "X-SpokenPlaces" },
  bosses: { icon: (lang) => `pipelines/bosses/assets/spoken-bosses-${lang}.tga`, tocPrefix: "X-SpokenBosses" },
  readables: {
    icon: (lang) => `pipelines/readables/assets/spoken-books-${lang}.tga`,
    tocPrefix: null,
    languageKey: "X-SpokenReadables-Language",
  },
};

// The .toc keys a derived pack adds (scripts/manager/release-pack.mjs), which the addon reads: the
// team of a pack carrying a slug, and the names of a language Spoken does not build in
// (addons/Spoken/Languages.lua).
const TOC_KEYS = {
  team: "X-Spoken-Team",
  teamName: "X-Spoken-TeamName",
  languageName: "X-Spoken-LanguageName",
  languageNative: "X-Spoken-LanguageNative",
};

/** A plan's `toc` as [key, value] lines, in a fixed order; none for a page pack's. */
export function tocExtra(toc = {}) {
  return Object.entries(TOC_KEYS).flatMap(([field, key]) => {
    const value = toc[field];
    if (value == null) return [];
    // A line break would end the line and start a key of the value's choosing.
    if (/[\r\n]/.test(value)) throw new Error(`${key} must be one line`);
    return [[key, value]];
  });
}

// English readables are their folder as committed, .toc and README: nothing is rewritten.
export const keepsCommittedFolder = (section, folder) => section === "readables" && folder === englishFolder(section);

export function rewriteToc(text, { folder, title, version, lang, tocPrefix, languageKey = null, extra = [] }) {
  const rewrites = [
    ["IconTexture", `Interface\\AddOns\\${folder}\\Textures\\AddonIcon.tga`],
    ["Title", title.replace(/^Spoken/, "|cffb48cffSpoken|r")],
    ["Version", version],
    ...(tocPrefix ? [[`${tocPrefix}-Quality`, "high"], [`${tocPrefix}-Bitrate`, "128"], [`${tocPrefix}-Language`, lang]] : []),
    ...(languageKey ? [[languageKey, lang]] : []),
  ];
  let out = text;
  for (const [name, value] of rewrites) {
    const line = new RegExp(`^## ${name}:.*$`, "m");
    // A pack whose .toc lost one of these would report itself as the wrong language or tier.
    if (!line.test(out)) throw new Error(`the .toc has no '## ${name}:' line to rewrite`);
    out = out.replace(line, () => `## ${name}: ${value}`);
  }
  if (extra.length > 0) {
    const lines = extra.map(([key, value]) => `## ${key}: ${value}`).join("\n");
    out = out.replace(/^## Version:.*$/m, (version) => `${version}\n${lines}`);
  }
  return out;
}

const notHidden = (path) => !basename(path).startsWith(".") && !path.endsWith(".part");

/**
 * `plan` is releasePlan's (release-pack.mjs), of the section's one folder; `readme` the README's
 * text, or null to keep English's.
 */
export async function stagePack(section, lang, { root, plan, readme = null }) {
  const shape = SECTIONS[section];
  if (!shape) throw new Error(`${section} has no Manager-only build`);
  const english = lang === BASE_LOCALE;
  const sourceName = englishFolder(section);
  const source = join(root, "addons", sourceName);
  const work = english ? source : join(root, "build", section, lang);
  const sounds = join(work, "Sounds");
  const lookup = join(work, "Data/Sounds.lua");
  if (!existsSync(sounds)) throw new Error(`no ${sounds}: run sounds.mjs first`);
  if (!existsSync(lookup)) throw new Error(`no ${lookup}: build its lookup first`);

  if (plan.folders.length !== 1) throw new Error(`a ${section} pack is one folder, not ${plan.folders.length}`);
  const [{ folder, title, version: planned }] = plan.folders;
  const target = join(root, "dist", folder);
  await rm(target, { recursive: true, force: true });
  const fromSource = (path) => {
    const rel = path.slice(source.length + 1);
    return rel !== "Sounds" && !rel.startsWith("Sounds/") && rel !== "Data/Sounds.lua" && notHidden(path);
  };
  await cp(source, target, { recursive: true, filter: fromSource });
  await cp(lookup, join(target, "Data/Sounds.lua"));
  await cp(sounds, join(target, "Sounds"), { recursive: true, filter: notHidden });
  const badge = shape.icon && join(root, shape.icon(lang));
  // A page pack's missing badge stays an error: it would look like English's in the AddOns list.
  // A derived pack's title names its language.
  if (!english && badge && (!plan.badgeOptional || existsSync(badge))) await cp(badge, join(target, "Textures/AddonIcon.tga"));
  if (readme != null) await writeFile(join(target, "README.md"), readme);

  const toc = join(target, `${folder}.toc`);
  if (folder !== sourceName) await rename(join(target, `${sourceName}.toc`), toc);
  const text = await readFile(toc, "utf8");
  // A language's version is its page's; English's is its .toc's.
  const version = planned ?? /^## Version:\s*(.+?)\s*$/m.exec(text)?.[1];
  if (!version) throw new Error(`no version for ${folder}`);
  if (!keepsCommittedFolder(section, folder)) {
    await writeFile(toc, rewriteToc(text, {
      folder, title, version, lang, tocPrefix: shape.tocPrefix,
      languageKey: shape.languageKey ?? null, extra: tocExtra(plan.toc),
    }));
  }
  return { folder, version };
}
