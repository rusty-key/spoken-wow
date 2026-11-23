#!/usr/bin/env node
// Checks that the FAQ (docs/support/FAQ.md) names only things that exist: every `/sp…` command,
// and every **bold** name, which the FAQ keeps for what a player sees on screen. A renamed setting
// or command fails the PR that renames it, so the FAQ is fixed in the same change, and Brann never
// sends a player looking for a button that is gone.
//
//   node apps/brann/src/faq-check.mjs
//
// A bold name passes when it is quoted text in the addons' English strings or the Manager's, or is
// on KNOWN below: names of packs, addons and places that no strings file holds.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT as ROOT } from "../../../pipelines/lib/env.mjs";
import { FAQ_PATH, loadFaq } from "./support.mjs";

// Bold words in the FAQ that are not UI text: packs, addons, apps and channels. Bold is for names
// alone; emphasis is written without it.
const KNOWN = new Set([
  "Quests", "Gossip", "Places", "Bosses", "Readables", "Alliance", "Horde", "Shared", "All",
  "Spoken: English", "Spoken Manager", "CurseForge app", "By hand", "DialogueUI", "Immersion",
  "Windows", "macOS", "Linux", "#bugs",
]);

// Commands that are not one of Spoken's words: the game's own, and /sp help, which is what /sp
// prints for any word it does not know.
const KNOWN_COMMANDS = new Set(["/reload", "/sp help"]);

const read = (path) => readFileSync(join(ROOT, path), "utf8");

function luaFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (name === "Libs" || name === "Tests" || name === "tests") continue;
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...luaFiles(path));
    else if (name.endsWith(".lua")) out.push(path);
  }
  return out;
}

/** The English text a player can see: every quoted string in the English strings files. */
function uiText() {
  const files = [
    ...readdirSync(join(ROOT, "addons")).flatMap((addon) => [
      `addons/${addon}/Strings.lua`, `addons/${addon}/Locale/enUS.lua`,
    ]),
    "apps/manager/src/renderer/src/strings.en.ts",
  ];
  const text = [];
  for (const file of files) {
    let source;
    try {
      source = read(file);
    } catch {
      continue;
    }
    // Lua text is in double quotes or [[ ]]; an apostrophe in it starts nothing. TypeScript quotes
    // with all three.
    const quoted = file.endsWith(".lua")
      ? /"((?:[^"\\\n]|\\.)*)"|\[\[([\s\S]*?)\]\]/g
      : /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`]*)`/g;
    for (const m of source.matchAll(quoted)) text.push(m[1] ?? m[2] ?? m[3]);
  }
  return text;
}

/** Each slash command root, as typed, and the addon folder whose code handles it. */
function slashRoots() {
  const roots = new Map();
  for (const addon of readdirSync(join(ROOT, "addons"))) {
    let files;
    try {
      files = luaFiles(`addons/${addon}`);
    } catch {
      continue;
    }
    for (const file of files) {
      const source = read(file);
      for (const m of source.matchAll(/SLASH_\w+\s*=\s*"(\/[a-z]+)"/g)) roots.set(m[1], addon);
      for (const m of source.matchAll(/RegisterOptionsTable\([^)]*\{([^}]*)\}/g)) {
        for (const name of m[1].matchAll(/"([a-z]+)"/g)) roots.set(`/${name[1]}`, addon);
      }
    }
  }
  return roots;
}

/** What the FAQ names: its slash commands and its bold names, each with the heading it is under. */
export function namesIn(faq) {
  const commands = [];
  const bold = [];
  let heading = "";
  for (const line of faq.split("\n")) {
    if (line.startsWith("## ")) heading = line.slice(3);
    for (const m of line.matchAll(/`(\/[a-z]+)((?: [a-z]+)?)/g)) commands.push({ root: m[1], sub: m[2].trim(), heading });
    for (const m of line.matchAll(/\*\*([^*]+)\*\*/g)) bold.push({ name: m[1], heading });
  }
  return { commands, bold };
}

/** The FAQ's names that nothing in the code has, as messages. */
export function check(faq, { text = uiText(), roots = slashRoots(), addonSource = (addon) => luaFiles(`addons/${addon}`).map(read).join("\n") } = {}) {
  const problems = [];
  const { commands, bold } = namesIn(faq);
  const sources = new Map();
  for (const { root, sub, heading } of commands) {
    if (KNOWN_COMMANDS.has(root) || KNOWN_COMMANDS.has(`${root} ${sub}`)) continue;
    const addon = roots.get(root);
    if (!addon) {
      problems.push(`"${heading}": ${root} is not a registered command`);
      continue;
    }
    if (!sub) continue;
    if (!sources.has(addon)) sources.set(addon, addonSource(addon));
    // A command word is compared as a quoted string, or is a key of an AceConfig options table,
    // whose commands ignore case.
    if (!new RegExp(`"${sub}"`).test(sources.get(addon)) && !new RegExp(`^\\s*${sub}\\s*=\\s*\\{`, "im").test(sources.get(addon))) {
      problems.push(`"${heading}": ${root} ${sub} is not a command ${addon} knows`);
    }
  }
  const seen = new Set();
  for (const { name, heading } of bold) {
    if (seen.has(name) || KNOWN.has(name)) continue;
    seen.add(name);
    if (!text.some((t) => t.includes(name))) problems.push(`"${heading}": **${name}** is in no English UI string`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = check(loadFaq());
  if (problems.length) {
    console.error(`${relative(ROOT, FAQ_PATH)} names things the code does not have:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error("Rename them in the FAQ, or add a name that is not UI text to KNOWN in apps/brann/src/faq-check.mjs.");
    process.exit(1);
  }
  console.log("FAQ names match the code");
}
