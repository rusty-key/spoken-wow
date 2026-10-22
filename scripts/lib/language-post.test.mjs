import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelName, isLanguageChannel, isNamed, languageOf, latestReleases, oldPosts, postText,
} from "./language-post.mjs";

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

test("a channel is found by its name, with or without an emoji and a bar in front", () => {
  assert.ok(isNamed({ name: "feedback-de-de" }, "feedback-de-de"));
  assert.ok(isNamed({ name: "🇩🇪｜feedback-de-de" }, "feedback-de-de"));
  assert.ok(!isNamed({ name: "old-feedback-de-de" }, "feedback-de-de"));
  assert.ok(!isNamed({ name: "🇦🇹｜feedback-de-de-at" }, "feedback-de-de"));
});

test("a language's channel is named in its own words, or with its feedback name", () => {
  assert.ok(isLanguageChannel({ name: "💬｜deutsch" }, "deDE"));
  assert.ok(isLanguageChannel({ name: "💬｜español-latam" }, "esMX"));
  assert.ok(isLanguageChannel({ name: "💬｜繁體中文" }, "zhTW"));
  assert.ok(isLanguageChannel({ name: "english" }, "enUS"));
  assert.ok(isLanguageChannel({ name: "💬｜feedback-de-de" }, "deDE"));
  assert.ok(!isLanguageChannel({ name: "💬｜español" }, "esMX"));
  assert.ok(!isLanguageChannel({ name: "💬｜español-latam" }, "esES"));
  assert.ok(!isLanguageChannel({ name: "deutsch-talk" }, "deDE"));
});

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

test("a new post replaces any bot's pinned post, but no person's and no other pin", () => {
  const pin = (id, bot, content) => ({ id, author: { bot }, content });
  const old = oldPosts([
    pin("1", true, "Audio packs:\n- Quests: a"),
    pin("2", true, "Audio packs:\n- Zones: b"),
    pin("3", false, "Audio packs: which one do I need?"),
    pin("4", true, "Welcome to the channel"),
  ]);
  assert.deepEqual(old.map((m) => m.id), ["1", "2"]);
});
