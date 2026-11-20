import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { plainTeamSql, releaseTeamId, releaseTeamSql, scriptTeamId } from "./release-team.mjs";
import { seedDatabase } from "./test-db.mjs";

const TEAM = "0b7e6a3c-1d2f-4a5b-8c9d-0e1f2a3b4c5d";

test("outside a release, a build reads the team with the language's plain packs", () => {
  assert.equal(releaseTeamSql("$1", {}), plainTeamSql("$1"));
  assert.equal(releaseTeamSql(`:'lang'`, { SPOKEN_RELEASE_TEAM: "" }), plainTeamSql(`:'lang'`));
  assert.equal(releaseTeamId({}), null);
});

test("in a release, it reads the release's team", () => {
  assert.equal(releaseTeamSql("$1", { SPOKEN_RELEASE_TEAM: TEAM }), `'${TEAM}'::uuid`);
  assert.equal(releaseTeamId({ SPOKEN_RELEASE_TEAM: TEAM.toUpperCase() }), TEAM);
});

test("anything but a uuid is refused, so nothing else is inlined", () => {
  assert.throws(() => releaseTeamSql("$1", { SPOKEN_RELEASE_TEAM: "x'); drop table take; --" }), /not a team id/);
  assert.throws(() => releaseTeamSql("$1", { SPOKEN_RELEASE_TEAM: "stimmen" }), /not a team id/);
});

// Needs DATABASE_URL naming a migrated test database, as an owner that bypasses row-level
// security; skipped without one.
const seed = seedDatabase();
const skip = seed ? false : "DATABASE_URL is not set";
let lang;
let lone;
let plain;
let other;
let only;

before(() => {
  if (!seed) return;
  lang = seed.language();
  lone = seed.language();
  plain = seed.team(lang);
  other = seed.team(lang, { packName: "slug" });
  only = seed.team(lone, { packName: "slug" });
});

after(() => seed?.cleanup());

const teamOf = (sql, code) => seed.sql(`select ${sql.replaceAll("$1", seed.lit(code))}`)[0]?.[0] || null;

test("outside a release, a language with no plain packs reads no team, not another", { skip }, () => {
  assert.equal(teamOf(releaseTeamSql("$1", {}), lang), plain.id);
  assert.equal(teamOf(releaseTeamSql("$1", {}), lone), null);
});

test("a script reads the team it names, else the one with plain packs", { skip }, () => {
  assert.equal(scriptTeamId(seed.url, lang), plain.id);
  assert.equal(scriptTeamId(seed.url, lang, other.slug), other.id);
  assert.equal(scriptTeamId(seed.url, lone, only.slug), only.id);
});

test("a script refuses a team that does not voice the language, and a language with no plain packs", { skip }, () => {
  assert.throws(() => scriptTeamId(seed.url, lone, other.slug), { message: `no team ${other.slug} voices ${lone}` });
  assert.throws(() => scriptTeamId(seed.url, lone), { message: `${lone} has no team with plain packs: name one with --team` });
});
