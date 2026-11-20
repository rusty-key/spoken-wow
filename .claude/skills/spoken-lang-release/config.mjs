// Reads a maintainer's settings for one language from ~/.claude/spoken/<lang>/config.json and
// the language's packs from publishers/ in this repository. Shared by check.mjs and zip.mjs.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");
export const REPO = resolve(SKILL, "../../..").replace(/\\/g, "/");
export const RELEASE_SH = `${REPO}/scripts/maintainers/spoken-release.sh`;

// "~" is the home folder; any other relative path is relative to `base` (the config's folder).
const home = (p, base = homedir()) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : resolve(base, p)).replace(/\\/g, "/");

export function loadConfig(lang) {
  const langs = [...new Set(publisherFiles().map((f) => frontmatter(f).lang).filter((l) => l && l !== "enUS"))].sort();
  if (!langs.includes(lang)) throw new Error(`--lang wants one of ${langs.join(", ")} (from publishers/), not ${lang}`);
  const dir = home(`~/.claude/spoken/${lang}`);
  const file = `${dir}/config.json`;
  if (!existsSync(file)) {
    throw new Error(`no ${file}: copy ${REPO}/.claude/skills/spoken-lang-daily/config.example.json there and fill in the release part`);
  }
  const c = JSON.parse(readFileSync(file, "utf8"));
  const r = c.release ?? {};
  if (!r.addonsDir) throw new Error(`${file} has no release.addonsDir`);
  return {
    lang,
    dir,
    addonsDir: home(r.addonsDir, dir),
    workDir: home(r.workDir ?? `${dir}/release`, dir),
    releaseEnv: r.releaseEnv ? home(r.releaseEnv, dir) : `${REPO}/scripts/maintainers/spoken-release.env`,
    webUpload: new Set(r.webUpload ?? []),
    minClips: r.minClips ?? 50,
    minShare: r.minShare ?? 0.02,
  };
}

// The pack folders spoken-release.sh knows, read from its `add_pack <section> <Folder>` lines and
// keyed by the release key prefix in publishers/: SpokenQuestsAudioAlliance -> quests-audio-alliance.
// A publisher with a CurseForge project and a prefix missing here is warned about.
const FOLDERS = Object.fromEntries(
  [...readFileSync(RELEASE_SH, "utf8").matchAll(/^add_pack \w+ (Spoken\w+)\s*$/gm)].map(([, folder]) => [
    folder.slice("Spoken".length).replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
    folder,
  ]),
);
if (!Object.keys(FOLDERS).length) throw new Error(`no add_pack lines found in ${RELEASE_SH}`);

function frontmatter(file) {
  const m = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function publisherFiles() {
  const root = `${REPO}/publishers`;
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(root, d.name)).filter((f) => f.endsWith(".md")).map((f) => `${root}/${d.name}/${f}`));
}

/** [folder, curseforgeProject, name] for every pack of the language that has a CurseForge project. */
export function packs(lang) {
  const out = [];
  for (const file of publisherFiles()) {
    const f = frontmatter(file);
    if (f.lang !== lang || !f.release || !f.curseforge) continue;
    if (!f.release.endsWith(`-${lang}`)) continue;
    const prefix = f.release.slice(0, -(lang.length + 1));
    if (FOLDERS[prefix]) out.push([`${FOLDERS[prefix]}_${lang}`, Number(f.curseforge), f.name]);
    else console.error(`warning: ${file} has release ${f.release}, which spoken-release.sh does not know; skipped`);
  }
  const order = Object.values(FOLDERS);
  return out.sort((a, b) => order.indexOf(a[0].split("_")[0]) - order.indexOf(b[0].split("_")[0]));
}

/** The language's meta package ("Spoken: German"), which depends on every pack. */
export function metaPackage(lang) {
  for (const file of publisherFiles()) {
    const f = frontmatter(file);
    if (f.lang === lang && /\/spoken\/all-/.test(file) && f.curseforge) return { project: Number(f.curseforge), name: f.name };
  }
  return null;
}
