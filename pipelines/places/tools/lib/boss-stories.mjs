// Data/Stories.lua as the export writes it, and the story tools' shared input and output rules.

import { isAbsolute, join, relative, resolve } from "node:path";

import { LOCALES } from "../../../lib/dungeons.mjs";
import { ROOT, luaString } from "./wiki.mjs";

/** Where the story tools write by default: gitignored scratch, never the addon. */
export const SCRATCH = join(ROOT, "build/boss-stories");

/**
 * `file`, resolved against `from`, unless it lies under addons/: the addon's Lua is an export of the
 * boss tables (make bosses-export), and a tool writing it would drop what the tables hold.
 */
export function outsideAddons(file, from = process.cwd()) {
  const path = resolve(from, file);
  const rel = relative(join(ROOT, "addons"), path);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error(`refusing to write ${path}: the story tools never write under addons/, whose boss data is exported from the boss tables (make bosses-export)`);
  }
  return path;
}

/** { map: { key: story } } as apply-boss-stories' input: { map, key, lang, text } per language. */
export function storyRows(stories) {
  const rows = [];
  for (const map of Object.keys(stories).map(Number).sort((a, b) => a - b)) {
    for (const key of Object.keys(stories[map]).sort()) {
      const story = stories[map][key];
      if (typeof story === "string") {
        rows.push({ map, key, lang: "enUS", text: story });
        continue;
      }
      if (story[1] !== undefined) rows.push({ map, key, lang: "enUS", text: story[1] });
      for (const lang of LOCALES) if (story[lang] !== undefined) rows.push({ map, key, lang, text: story[lang] });
    }
  }
  return rows;
}

/**
 * One row of apply-boss-stories' input, `lang` defaulting to enUS: null for an empty story or a
 * dungeon's own ("_"). Throws on a language the project does not have.
 */
export function storyInput(row) {
  const text = String(row.text ?? "").trim();
  if (!text || row.key === "_") return null;
  const lang = row.lang ?? "enUS";
  if (lang !== "enUS" && !LOCALES.includes(lang)) {
    throw new Error(`${row.map} "${row.key}": unknown lang ${JSON.stringify(lang)}`);
  }
  return { map: row.map, key: row.key, lang, text };
}

/** A story as Lua: English, or { 1?: English, deDE: ... } as { "English", deDE = "..." }, locales in LOCALES order. */
function entry(story) {
  if (typeof story === "string") return luaString(story);
  const parts = [];
  if (story[1] !== undefined) parts.push(luaString(story[1]));
  for (const locale of LOCALES) if (story[locale] !== undefined) parts.push(`${locale} = ${luaString(story[locale])}`);
  return parts.length === 1 && story[1] !== undefined ? luaString(story[1]) : `{ ${parts.join(", ")} }`;
}

/** The Lua file: `stories` is { map: { key: story } }. */
export function renderStories(stories) {
  const blocks = Object.keys(stories)
    .map(Number)
    .sort((a, b) => a - b)
    .map((map) => {
      const lines = Object.keys(stories[map])
        .sort()
        .map((key) => `\t\t[${luaString(key)}] = ${entry(stories[map][key])},`);
      return `\t[${map}] = {\n${lines.join("\n")}\n\t},`;
    });
  return `-- The bosses' stories, by instance map and the boss's key (Data/Bosses.lua):
--   SpokenBossStories[map][key] = "The words of its story."
-- Written from the Adventure Guide's text and from warcraft.wiki.gg (CC BY-SA 4.0), rewritten in one
-- voice and kept to Classic (THIRD_PARTY.md). A boss with no entry shows that its story is not written yet.
-- Exported from the boss tables by pipelines/places/tools/bosses/export.mjs (make bosses-export).

SpokenBossStories = SpokenBossStories or {}
for map, stories in pairs({
${blocks.join("\n")}
}) do
\tSpokenBossStories[map] = stories
end
`;
}

/** Splits `stories` ({ map, key, lang, file }) by whether idOf ("map\tkey" -> boss id) holds their boss. */
export function resolveStories(stories, idOf) {
  const resolved = [];
  const unresolved = [];
  for (const story of stories) {
    const bossId = idOf.get(`${story.map}\t${story.key}`);
    if (bossId === undefined) unresolved.push(story);
    else resolved.push({ ...story, bossId });
  }
  return { resolved, unresolved };
}
