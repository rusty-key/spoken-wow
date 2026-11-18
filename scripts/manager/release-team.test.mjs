// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import pg from "pg";

import { seedDatabase } from "../../pipelines/lib/test-db.mjs";
import { languageNames, releaseTeam } from "./release-team.mjs";

const seed = seedDatabase();
const skip = seed ? false : "DATABASE_URL is not set";
const db = seed && new pg.Pool({ connectionString: seed.url, max: 1 });
let lang;
let other;
let first;
let second;
let elsewhere;

before(async () => {
  if (!seed) return;
  lang = await seed.language({ name: "Xq German", native: "Xq Deutsch" });
  other = await seed.language();
  first = await seed.team(lang, { privileged: true, official: true });
  second = await seed.team(lang, { privileged: false, official: false, name: "Stimmen" });
  elsewhere = await seed.team(other, { privileged: true });
});

after(async () => {
  await seed?.cleanup();
  await db?.end();
});

test("the language's privileged team builds plain packs", { skip }, async () => {
  const team = await releaseTeam(db, lang, first.slug);
  assert.deepEqual(team, {
    id: first.id, slug: first.slug, name: first.name, official: true, privileged: true, plain: true,
    language: { code: lang, name: "Xq German", native: "Xq Deutsch", client: false },
  });
});

test("a second team does not", { skip }, async () => {
  const team = await releaseTeam(db, lang, second.slug);
  assert.equal(team.id, second.id);
  assert.equal(team.name, "Stimmen");
  assert.equal(team.official, false);
  assert.equal(team.privileged, false);
  assert.equal(team.plain, false);
});

test("no slug is the privileged team, as a release from before teams had", { skip }, async () => {
  assert.equal((await releaseTeam(db, lang, null)).id, first.id);
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
