// A sound pack's folder in dist/, for the Manager channel: what the section's package-audio.sh
// leaves there, without the zip. Its clips may be pointers (scripts/lib/clip-pointer.mjs).
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findPack } from "../lib/packs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENGLISH = "enUS";

// Whatever a section does differently: its English folder, its languages' badged icons, and the
// .toc lines naming a pack's tier and language, which its Data/Sounds.lua reads back.
const SECTIONS = {
  // English's page is named for the CurseForge project, which also carries the bosses; this pack does not.
  places: { source: "SpokenPlacesAudio", englishTitle: "Spoken Audio: Places", icon: (lang) => `pipelines/places/assets/spoken-zones-${lang}.tga`, tocPrefix: "X-SpokenPlaces" },
  bosses: { source: "SpokenBossesAudio", icon: null, tocPrefix: "X-SpokenBosses" },
  readables: { source: "SpokenReadablesAudio", icon: (lang) => `pipelines/readables/assets/spoken-books-${lang}.tga`, tocPrefix: null },
};

export function rewriteToc(text, { folder, title, version, lang, tocPrefix }) {
  const rewrites = [
    ["IconTexture", `Interface\\AddOns\\${folder}\\Textures\\AddonIcon.tga`],
    ["Title", title.replace(/^Spoken/, "|cffb48cffSpoken|r")],
    ["Version", version],
    ...(tocPrefix ? [[`${tocPrefix}-Quality`, "high"], [`${tocPrefix}-Bitrate`, "128"], [`${tocPrefix}-Language`, lang]] : []),
  ];
  let out = text;
  for (const [name, value] of rewrites) {
    const line = new RegExp(`^## ${name}:.*$`, "m");
    // A pack whose .toc lost one of these would report itself as the wrong language or tier.
    if (!line.test(out)) throw new Error(`the .toc has no '## ${name}:' line to rewrite`);
    out = out.replace(line, () => `## ${name}: ${value}`);
  }
  return out;
}

const notHidden = (path) => !basename(path).startsWith(".") && !path.endsWith(".part");

export async function stagePack(section, lang, { root = ROOT, dist = join(root, "dist"), pack = findPack(section, lang), readme } = {}) {
  const shape = SECTIONS[section];
  if (!shape) throw new Error(`${section} has no Manager-only build`);
  const english = lang === ENGLISH;
  const source = join(root, "addons", shape.source);
  const work = english ? source : join(root, "build", section, lang);
  const sounds = join(work, "Sounds");
  const lookup = join(work, "Data/Sounds.lua");
  if (!existsSync(sounds)) throw new Error(`no ${sounds}: run sounds.mjs first`);
  if (!existsSync(lookup)) throw new Error(`no ${lookup}: build its lookup first`);

  const folder = pack.folder;
  const target = join(dist, folder);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const fromSource = (path) => {
    const rel = path.slice(source.length + 1);
    return rel !== "Sounds" && !rel.startsWith("Sounds/") && rel !== "Data/Sounds.lua" && notHidden(path);
  };
  await cp(source, target, { recursive: true, filter: fromSource });
  await mkdir(join(target, "Data"), { recursive: true });
  await cp(lookup, join(target, "Data/Sounds.lua"));
  await cp(sounds, join(target, "Sounds"), { recursive: true, filter: notHidden });
  if (!english && shape.icon) await cp(join(root, shape.icon(lang)), join(target, "Textures/AddonIcon.tga"));
  if (readme != null) await writeFile(join(target, "README.md"), readme);

  const toc = join(target, `${folder}.toc`);
  if (folder !== shape.source) await rename(join(target, `${shape.source}.toc`), toc);
  const text = await readFile(toc, "utf8");
  // A language's version is its page's; English's is its .toc's.
  const version = pack.version ?? /^## Version:\s*(.+?)\s*$/m.exec(text)?.[1];
  if (!version) throw new Error(`no version for ${folder}`);
  // English readables are its folder as committed, the one pack nothing is rewritten in.
  if (!(section === "readables" && english)) {
    await writeFile(toc, rewriteToc(text, { folder, title: (english && shape.englishTitle) || pack.name, version, lang, tocPrefix: shape.tocPrefix }));
  }
  return { folder, version, path: target };
}
