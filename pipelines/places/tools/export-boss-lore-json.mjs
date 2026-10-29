#!/usr/bin/env node
// Export the boss stories and their localized game names for the website.
//
// Data/Stories.lua and Data/Bosses.lua are Lua build inputs. The web app is TypeScript, so
// this small bridge evaluates the files with the same Lua 5.1 interpreter used by the addon
// tests and writes a deterministic JSON catalog. Translated prose may be supplied in
// translations/boss-lore/<locale>.json; the English text remains the source of truth.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const STORIES = join(ROOT, "addons/Spoken_NPCs/Data/Stories.lua");
const BOSSES = join(ROOT, "addons/Spoken_NPCs/Data/Bosses.lua");
const DUNGEONS = join(ROOT, "addons/Spoken/Data/Dungeons.lua");
const OUT = join(ROOT, "apps/web/src/data/boss-lore.json");
const LOCALES = ["enUS", "deDE", "esES", "esMX", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW"];

const LUA = String.raw`
-- With LuaJIT's -e form, the first positional path is arg[0].
local storiesFile, bossesFile, dungeonsFile = arg[0], arg[1], arg[2]
dofile(storiesFile)
dofile(bossesFile)
dofile(dungeonsFile)

local locales = { "enUS", "deDE", "esES", "esMX", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW" }

local function quote(value)
  value = tostring(value or "")
  value = value:gsub("\\", "\\\\")
    :gsub('"', '\\"')
    :gsub("\r", "\\r")
    :gsub("\n", "\\n")
    :gsub("\t", "\\t")
  return '"' .. value .. '"'
end

local function localized(entry)
  local out = {}
  for _, locale in ipairs(locales) do
    local value = entry and entry[locale]
    if value == nil and entry then value = entry[1] end
    if type(value) == "string" and value ~= "" then out[locale] = value end
  end
  return out
end

local function object(values)
  local out = {}
  for _, locale in ipairs(locales) do
    if values[locale] then table.insert(out, quote(locale) .. ":" .. quote(values[locale])) end
  end
  return "{" .. table.concat(out, ",") .. "}"
end

local function dungeon(map)
  return (SpokenDungeons.dungeons and SpokenDungeons.dungeons[map])
      or (SpokenDungeons.worldBosses and SpokenDungeons.worldBosses[map])
end

local rows = {}
for map, bosses in pairs(SpokenBosses.maps or {}) do
  for _, boss in ipairs(bosses) do
    local story = SpokenBossStories[map] and SpokenBossStories[map][boss.key]
    if story then
      local text = type(story) == "table" and (story[1] or story.enUS) or story
      if type(text) == "string" and text ~= "" then
        local stories = {}
        if type(story) == "table" then
          for _, locale in ipairs(locales) do
            if type(story[locale]) == "string" and story[locale] ~= "" then stories[locale] = story[locale] end
          end
        end
        stories.enUS = stories.enUS or text
        local home = dungeon(map)
        table.insert(rows, "{\"map\":" .. tostring(map) .. ",\"key\":" .. quote(boss.key)
          .. ",\"names\":" .. object(localized(boss))
          .. ",\"dungeons\":" .. object(localized(home))
          .. ",\"stories\":" .. object(stories) .. "}")
      end
    end
  end
end
print("[" .. table.concat(rows, ",") .. "]")
`;

let raw;
try {
  raw = execFileSync("luajit", ["-e", LUA, STORIES, BOSSES, DUNGEONS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
} catch (error) {
  // The managed development sandbox can report EPERM after a successful child
  // process exit, while still exposing the complete stdout and status 0.
  if (error?.status === 0 && typeof error.stdout === "string") raw = error.stdout;
  else throw error;
}

const rows = JSON.parse(raw);
rows.sort((a, b) => a.map - b.map || a.key.localeCompare(b.key));

const translationRoot = join(ROOT, "translations/boss-lore");
for (const locale of LOCALES.slice(1)) {
  let translated;
  try {
    translated = JSON.parse(await readFile(join(translationRoot, `${locale}.json`), "utf8"));
  } catch {
    translated = {};
  }
  for (const row of rows) {
    const text = translated[`${row.map}:${row.key}`];
    if (typeof text === "string" && text.trim()) row.stories[locale] = text.trim();
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify({ version: 1, locales: LOCALES, bosses: rows }, null, 2)}\n`);
console.log(`${rows.length} boss stories -> ${OUT}`);
