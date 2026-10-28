#!/usr/bin/env node
// Import localized Adventure Guide prose only when it is the exact English source of a
// story already in Stories.lua. This avoids attaching a short official description to a
// longer rewritten story and calling it a translation.
//
// Build the source first with:
//   node pipelines/places/tools/build-boss-stories.mjs --out /tmp/boss-guide.lua --no-wiki
// Then run:
//   node pipelines/places/tools/import-boss-guide-translations.mjs /tmp/boss-guide.lua

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const GUIDE = process.argv[2];
if (!GUIDE) throw new Error("usage: import-boss-guide-translations.mjs <localized-guide.lua>");

const STORIES = join(ROOT, "addons/Spoken_NPCs/Data/Stories.lua");
const LOCALES = ["deDE", "esES", "esMX", "frFR", "itIT", "ptBR", "ruRU", "koKR", "zhCN", "zhTW", "viVN"];
const LUA = String.raw`
local currentFile, guideFile = arg[0], arg[1]
dofile(currentFile)
local current = {}
for map, stories in pairs(SpokenBossStories or {}) do
  current[map] = {}
  for key, story in pairs(stories) do
    local text = type(story) == "table" and (story[1] or story.enUS) or story
    if type(text) == "string" then current[map][key] = text end
  end
end
dofile(guideFile)
local locales = { "deDE", "esES", "esMX", "frFR", "itIT", "ptBR", "ruRU", "koKR", "zhCN", "zhTW", "viVN" }
local function quote(value)
  value = tostring(value or "")
  value = value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\r", "\\r"):gsub("\n", "\\n"):gsub("\t", "\\t")
  return '"' .. value .. '"'
end
local rows = {}
for map, stories in pairs(current) do
  for key, english in pairs(stories) do
    local guide = SpokenBossStories[map] and SpokenBossStories[map][key]
    local guideEnglish = type(guide) == "table" and (guide[1] or guide.enUS) or guide
    if english == guideEnglish and type(guide) == "table" then
      local values = {}
      for _, locale in ipairs(locales) do
        if type(guide[locale]) == "string" and guide[locale] ~= "" then
          table.insert(values, quote(locale) .. ":" .. quote(guide[locale]))
        end
      end
      table.insert(rows, "{\"map\":" .. tostring(map) .. ",\"key\":" .. quote(key) .. ",\"texts\":{" .. table.concat(values, ",") .. "}}")
    end
  end
end
print("[" .. table.concat(rows, ",") .. "]")
`;

let raw;
try {
  raw = execFileSync("luajit", ["-e", LUA, STORIES, GUIDE], { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
} catch (error) {
  if (error?.status === 0 && typeof error.stdout === "string") raw = error.stdout;
  else throw error;
}

const matches = JSON.parse(raw);
const output = new Map(LOCALES.map((locale) => [locale, {}]));
for (const row of matches) {
  for (const locale of LOCALES) {
    const text = row.texts[locale];
    if (text) output.get(locale)[`${row.map}:${row.key}`] = text;
  }
}

const destination = join(ROOT, "translations/boss-lore");
await mkdir(destination, { recursive: true });
for (const [locale, values] of output) {
  await writeFile(join(destination, `${locale}.json`), `${JSON.stringify(values, null, 2)}\n`);
}
console.log(`${matches.length} exact Adventure Guide stories matched; wrote ${LOCALES.length} locale files`);
