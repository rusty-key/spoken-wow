import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { announcement } from "./announce.mjs";
import { SECTIONS } from "./packs.mjs";

// A repo in a temp directory: publishers/ pages as [group, file, frontmatter], and one
// CHANGELOG.md in the section's docs folder per entry of `changelogs`.
function repo(pages, changelogs) {
  const dir = mkdtempSync(join(tmpdir(), "announce-"));
  for (const [group, file, fields] of pages) {
    mkdirSync(join(dir, "publishers", group), { recursive: true });
    const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
    writeFileSync(join(dir, "publishers", group, file), `---\n${lines.join("\n")}\n---\n\nBody.\n`);
  }
  for (const [section, text] of Object.entries(changelogs)) {
    mkdirSync(join(dir, "docs", section), { recursive: true });
    writeFileSync(join(dir, "docs", section, "CHANGELOG.md"), text);
  }
  const dirs = { publishersDir: join(dir, "publishers"), docsDir: join(dir, "docs") };
  return (tag) => announcement(tag, dirs);
}

const pages = [
  ["places", "addon.md", { slug: "spoken-zones", name: "Spoken Zones" }],
  ["places", "a.md", { section: "places", lang: "enUS", release: "places-audio",
    slug: "spoken-audio-places", name: "Spoken Zones Audio" }],
  ["places", "b.md", { section: "places", lang: "frFR", version: "2.0.0", release: "places-audio-frFR",
    slug: "spoken-french-audio-places", name: "Spoken Zones Audio: French" }],
  ["quests", "player.md", { slug: "spoken-quests", name: "Spoken Quests" }],
  ["quests", "h.md", { section: "quests", lang: "enUS", pack: "horde", release: "quests-audio-horde",
    slug: "spoken-audio-quests-horde", name: "Spoken Quests Audio: Horde" }],
  ["spoken", "all.md", { slug: "spoken-english", name: "Spoken: English" }],
  ["spoken", "all-dede.md", { lang: "deDE", slug: "spoken-german", name: "Spoken: German" }],
  ["spoken", "spoken.md", { slug: "spoken", name: "Spoken" }],
];

const places = `# Changelog

## 2.0.1 — audio — 2026-09-18

- Audio notes.

## 2.0.1 — 2026-09-18

- Addon notes.

## 2.0.0 — places-audio-frFR — 2026-09-26

- French notes.
`;

const quests = `## 2.2.0 — Spoken Quests Audio

Audio notes.

## 2.2.0 — player

Newer player notes.

## 2.1.0 — sound packs

Pack notes.

## 2.1.0 — player

Player notes.
`;

const spoken = `## 3.5.1 — 2026-10-19

- Spoken notes.
`;

const run = repo(pages, { places, quests, spoken });

test("an addon takes the store page's name and its own heading, not its audio's", () => {
  assert.deepEqual(run("places/v2.0.1"), { name: "Spoken Zones", version: "2.0.1", notes: "- Addon notes." });
});

test("spoken is named by its own page, not by a meta addon beside it", () => {
  assert.deepEqual(run("spoken/v3.5.1"), { name: "Spoken", version: "3.5.1", notes: "- Spoken notes." });
});

test("English audio takes the heading its kind word marks", () => {
  assert.equal(run("places-audio/v2.0.1").notes, "- Audio notes.");
  assert.equal(run("quests-audio-horde/v2.1.0").notes, "Pack notes.");
  assert.equal(run("quests/v2.1.0").notes, "Player notes.");
  // The heading quests' packs are written under since 2.2.0.
  assert.equal(run("quests-audio-horde/v2.2.0").notes, "Audio notes.");
  assert.equal(run("quests/v2.2.0").notes, "Newer player notes.");
});

test("a language pack takes its tag's heading, and the heading line is dropped", () => {
  assert.deepEqual(run("places-audio-frFR/v2.0.0"),
    { name: "Spoken Zones Audio: French", version: "2.0.0", notes: "- French notes." });
});

test("a version with no changelog section still announces, without notes", () => {
  assert.deepEqual(run("places/v9.9.9"), { name: "Spoken Zones", version: "9.9.9", notes: null });
});

test("a tag with no store page behind it is skipped", () => {
  assert.ok(run("legacy/quests/v1.0.0").skip);
  assert.ok(run("not-a-release").skip);
});

test("every section's changelog is where the release scripts look", () => {
  const docs = join(import.meta.dirname, "../../docs");
  for (const section of ["spoken", ...SECTIONS]) {
    assert.ok(existsSync(join(docs, section, "CHANGELOG.md")), section);
  }
});
