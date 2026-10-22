// Data/Stories.lua, as every boss story tool writes it.

import { luaString } from "./wiki.mjs";

/** A story as Lua: English, or { 1: English, deDE: ... } as { "English", deDE = "..." }. */
function entry(story) {
  if (typeof story === "string") return luaString(story);
  const extra = Object.keys(story).filter((k) => k !== "1");
  if (extra.length === 0) return luaString(story[1]);
  return `{ ${luaString(story[1])}, ${extra.map((k) => `${k} = ${luaString(story[k])}`).join(", ")} }`;
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
-- Built by pipelines/zones/tools/assemble-boss-stories.mjs and apply-boss-stories.mjs.

SpokenBossStories = SpokenBossStories or {}
for map, stories in pairs({
${blocks.join("\n")}
}) do
\tSpokenBossStories[map] = stories
end
`;
}
