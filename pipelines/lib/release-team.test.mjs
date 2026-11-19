import { test } from "node:test";
import assert from "node:assert/strict";

import { releaseTeamId, releaseTeamSql } from "./release-team.mjs";

const TEAM = "0b7e6a3c-1d2f-4a5b-8c9d-0e1f2a3b4c5d";

test("outside a release, a build reads the language's privileged team", () => {
  assert.equal(releaseTeamSql("$1", {}), "team_of_lang($1)");
  assert.equal(releaseTeamSql(`:'lang'`, { SPOKEN_RELEASE_TEAM: "" }), `team_of_lang(:'lang')`);
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
