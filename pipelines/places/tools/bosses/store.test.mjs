// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one.
import { randomInt } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { seedDatabase } from "../../../lib/test-db.mjs";
import { close, readLiveTakes } from "./store.mjs";

const seed = seedDatabase();
const skip = seed ? false : "DATABASE_URL is not set";
let lang;
let a;
let b;
let lineId;

before(() => {
  if (!seed) return;
  lang = seed.language();
  a = seed.team(lang);
  b = seed.team(lang, { packName: "slug" });
  const map = 900_000_000 + randomInt(1e8);
  lineId = `boss:${map}:boss`;
  seed.take({ team: a.id, source: "bosses", lang, file: `boss-${map}`, lineId, sha256: "a".repeat(64), shownText: "A" });
  seed.take({ team: b.id, source: "bosses", lang, file: `boss-${map}`, lineId, sha256: "b".repeat(64), shownText: "B" });
});

after(async () => {
  delete process.env.SPOKEN_RELEASE_TEAM;
  await close();
  seed?.cleanup();
});

test("a release reads its own team's live boss takes; a build outside one, the plain team's", { skip }, async () => {
  process.env.SPOKEN_RELEASE_TEAM = b.id;
  assert.deepEqual((await readLiveTakes(lang)).map((take) => [take.lineId, take.text]), [[lineId, "B"]]);
  delete process.env.SPOKEN_RELEASE_TEAM;
  assert.deepEqual((await readLiveTakes(lang)).map((take) => [take.lineId, take.text]), [[lineId, "A"]]);
});
