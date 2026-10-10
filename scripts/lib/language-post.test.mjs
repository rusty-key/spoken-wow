import { test } from "node:test";
import assert from "node:assert/strict";

import { channelName, languageOf, latestReleases, postText } from "./language-post.mjs";

const url = (tag) => `https://github.com/o/r/releases/tag/${tag}`;
const release = (tag, extra = {}) => ({ tag_name: tag, html_url: url(tag), draft: false, prerelease: false, ...extra });

const packs = [
  { section: "zones", lang: "deDE", release: "zones-audio-deDE", github: true },
  { section: "quests", lang: "deDE", release: "quests-audio-deDE", github: true },
  { section: "books", lang: "deDE", release: "books-audio-deDE", github: true },
  { section: "zones", lang: "frFR", release: "zones-audio-frFR", github: true },
  { section: "zones", lang: "enUS", release: "zones-audio", github: true },
  { section: "quests", lang: "enUS", release: "quests-audio-horde", github: false },
];

test("channel names follow the code in lower case", () => {
  assert.equal(channelName("deDE"), "feedback-de-de");
  assert.equal(channelName("zhTW"), "feedback-zh-tw");
});

test("the newest shipped release wins, by version rather than by order", () => {
  const latest = latestReleases([
    release("zones-audio-deDE/v2.1.0"),
    release("zones-audio-deDE/v2.10.0"),
    release("zones-audio-deDE/v2.9.0"),
    release("zones-audio-deDE/v3.0.0", { draft: true }),
    release("zones-audio-deDE/v2.11.0", { prerelease: true }),
    release("zones-audio-frFR/v9.0.0"),
  ], ["zones-audio-deDE"]);
  assert.deepEqual(latest, { "zones-audio-deDE": { tag: "zones-audio-deDE/v2.10.0", url: url("zones-audio-deDE/v2.10.0") } });
});

test("the post lists quests, zones, books and leaves out a pack never released", () => {
  const de = packs.filter((p) => p.lang === "deDE");
  const latest = latestReleases(
    [release("zones-audio-deDE/v2.1.0"), release("quests-audio-deDE/v0.0.4")],
    de.map((p) => p.release),
  );
  assert.equal(postText(de, latest), [
    "Audio packs:",
    `- Quests: ${url("quests-audio-deDE/v0.0.4")}`,
    `- Zones: ${url("zones-audio-deDE/v2.1.0")}`,
  ].join("\n"));
  assert.equal(postText(de, {}), null);
});

test("a tag resolves to its language's GitHub packs; English and addons are skipped", () => {
  const de = languageOf("books-audio-deDE/v2.1.0", packs);
  assert.equal(de.lang, "deDE");
  assert.deepEqual(de.packs.map((p) => p.release).sort(), ["books-audio-deDE", "quests-audio-deDE", "zones-audio-deDE"]);
  assert.ok(languageOf("zones-audio/v2.2.1", packs).skip);
  assert.ok(languageOf("spoken/v3.1.0", packs).skip);
});
