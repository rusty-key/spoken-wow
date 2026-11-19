// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one. The store fixes its language when it loads, so each
// read is its own process.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { seedDatabase } from "../../../lib/test-db.mjs";

const STORE = join(dirname(fileURLToPath(import.meta.url)), "store.mjs");
const seed = seedDatabase();
const skip = seed ? false : "DATABASE_URL is not set";
let lang;
let a;
let b;

before(() => {
  if (!seed) return;
  lang = seed.language();
  a = seed.team(lang);
  b = seed.team(lang, { packName: "slug" });
  seed.take({ team: a.id, source: "places", lang, file: "z-1", lineId: "z:1", sha256: "a".repeat(64), shownText: "A" });
  seed.take({ team: b.id, source: "places", lang, file: "z-1", lineId: "z:1", sha256: "b".repeat(64), shownText: "B" });
});

after(() => seed?.cleanup());

function manifest(env) {
  const script = `const store = await import(${JSON.stringify(STORE)});
                  console.log(JSON.stringify(await store.loadManifest())); await store.close();`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, SPOKEN_RELEASE_TEAM: "", DATABASE_URL: seed.url, SPOKEN_PLACES_LANG: lang, ...env },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("a release reads its own team's live take of a line, not the privileged team's", { skip }, () => {
  assert.equal(manifest({ SPOKEN_RELEASE_TEAM: b.id })["z:1"].shownText, "B");
  assert.equal(manifest({ SPOKEN_RELEASE_TEAM: a.id })["z:1"].shownText, "A");
});

test("a language only the site knows is refused outside a release", { skip }, () => {
  assert.throws(() => manifest({}), /is not a language/);
});
