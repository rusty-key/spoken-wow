// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import pg from "pg";

import { seedDatabase } from "../../pipelines/lib/test-db.mjs";
import { languageNames, releaseTeam, teamPackFolders } from "./release-team.mjs";

const seed = seedDatabase();
const skip = seed ? false : "DATABASE_URL is not set";
const db = seed && new pg.Pool({ connectionString: seed.url, max: 1 });
let lang;
let other;
let only;
let first;
let second;
let elsewhere;

before(async () => {
  if (!seed) return;
  lang = await seed.language({ name: "Xq German", native: "Xq Deutsch" });
  other = await seed.language();
  only = await seed.language();
  first = await seed.team(lang, { packName: "plain", official: true });
  second = await seed.team(lang, { packName: "slug", official: false, name: "Stimmen" });
  elsewhere = await seed.team(other, { packName: "plain" });
  await seed.team(only, { packName: "slug", official: false });
});

after(async () => {
  await seed?.cleanup();
  await db?.end();
});

test("a team with plain packs builds them", { skip }, async () => {
  const team = await releaseTeam(db, lang, first.slug);
  assert.deepEqual(team, {
    id: first.id, slug: first.slug, name: first.name, official: true, packName: "plain",
    language: { code: lang, name: "Xq German", native: "Xq Deutsch", client: false },
  });
});

test("a team whose packs carry its slug builds those", { skip }, async () => {
  const team = await releaseTeam(db, lang, second.slug);
  assert.equal(team.id, second.id);
  assert.equal(team.name, "Stimmen");
  assert.equal(team.official, false);
  assert.equal(team.packName, "slug");
});

test("no slug is the language's only team, whatever its packs are named", { skip }, async () => {
  assert.equal((await releaseTeam(db, other, null)).id, elsewhere.id);
  assert.equal((await releaseTeam(db, only, null)).packName, "slug");
});

test("no slug in a language with several teams is refused, not given a main team", { skip }, async () => {
  await assert.rejects(releaseTeam(db, lang, null), { message: `${lang} has several teams: name one with --team` });
});

test("a language with no team is refused", { skip }, async () => {
  const empty = await seed.language();
  await assert.rejects(releaseTeam(db, empty, null), { message: `${empty} has no team` });
});

test("a team that does not voice the language is refused", { skip }, async () => {
  await assert.rejects(releaseTeam(db, lang, elsewhere.slug), { message: `no team ${elsewhere.slug} voices ${lang}` });
});

test("a code with no language row is refused", { skip }, async () => {
  await assert.rejects(releaseTeam(db, "qqQQ", null), { message: "qqQQ is not a language" });
});

test("every language's names come with it, for index-v2.json", { skip }, async () => {
  const names = await languageNames(db);
  assert.deepEqual(names.find((row) => row.code === lang), { code: lang, name: "Xq German", native: "Xq Deutsch" });
  assert.ok(names.some((row) => row.code === "deDE"));
});

test("a delisting takes every folder the team's pack can have: plain or with its slug, as its pack name says", { skip }, async () => {
  const sides = ["Alliance", "Horde", "Shared", "Gossip"];
  assert.deepEqual(await teamPackFolders(db, "quests", lang, second.slug), sides.map((side) => `SpokenQuestsAudio${side}_${lang}_${second.slug}`));
  assert.deepEqual(await teamPackFolders(db, "places", lang, first.slug), [`SpokenPlacesAudio_${lang}`]);
  await assert.rejects(teamPackFolders(db, "places", lang, elsewhere.slug), { message: `no team ${elsewhere.slug} voices ${lang}` });
});
