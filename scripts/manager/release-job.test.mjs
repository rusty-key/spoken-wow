import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { jobEnv, pruneRuns, runJob } from "./release-job.mjs";

const temp = () => mkdtempSync(join(tmpdir(), "release-job-"));

function fakeTools(script) {
  const tools = temp();
  mkdirSync(join(tools, "scripts/manager"), { recursive: true });
  writeFileSync(join(tools, "scripts/manager/release.mjs"), script);
  return tools;
}

function runDirectory() {
  const runDir = temp();
  writeFileSync(join(runDir, "heartbeat"), "");
  return runDir;
}

test("the job gets the signing keys and only what it needs of the site's", async () => {
  const shared = temp();
  writeFileSync(join(shared, "app.env"), "DATABASE_URL=postgres://owner\nAPP_DATABASE_URL=postgres://app\nSPOKEN_SECRET_KEY=site\nSPOKEN_ARCHIVE_URL=https://a\nR2_ACCOUNT_ID=acct\nSPOKEN_PLACES_MANIFEST=/srv/manifest.json\n");
  writeFileSync(join(shared, "release.env"), "SPOKEN_PACKS_SIGNING_KEY=key\nR2_BUCKET=spoken-packs\n");
  const env = await jobEnv(join(shared, "release.env"), { PATH: "/bin", HOME: "/h", SPOKEN_ARCHIVE_ACCESS_KEY_ID: "archive" });
  assert.deepEqual(env, {
    PATH: "/bin",
    HOME: "/h",
    DATABASE_URL: "postgres://owner",
    R2_ACCOUNT_ID: "acct",
    SPOKEN_ARCHIVE_URL: "https://a",
    SPOKEN_PACKS_SIGNING_KEY: "key",
    R2_BUCKET: "spoken-packs",
  });
});

test("the job opens team releases where the site has them open, from the same line of app.env", async () => {
  const shared = temp();
  writeFileSync(join(shared, "app.env"), "SPOKEN_TEAM_RELEASES=1\n");
  writeFileSync(join(shared, "release.env"), "R2_BUCKET=spoken-packs-staging\n");
  assert.equal((await jobEnv(join(shared, "release.env"), { PATH: "/bin", HOME: "/h" })).SPOKEN_TEAM_RELEASES, "1");
});

test("release.env can send the archive's reads through the site; the job needs no recordings token", async () => {
  const shared = temp();
  writeFileSync(join(shared, "app.env"), "SPOKEN_ARCHIVE_URL=https://a\nSPOKEN_ARCHIVE_TOKEN=t\n");
  writeFileSync(join(shared, "release.env"), "SPOKEN_ARCHIVE_URL=http://127.0.0.1:3010/api/archive/\n");
  const env = await jobEnv(join(shared, "release.env"), { PATH: "/bin", HOME: "/h" });
  assert.equal(env.SPOKEN_ARCHIVE_URL, "http://127.0.0.1:3010/api/archive/");
  // It pulls takes only, which are anybody's.
  assert.equal(env.SPOKEN_ARCHIVE_TOKEN, undefined);
});

test("a run logs its output, records its code, and leaves no scratch copy", async () => {
  const tools = fakeTools(`console.log("==> step 1/1: " + process.argv.slice(2).join(" ")); console.error("to stderr");`);
  const runDir = runDirectory();
  assert.equal(await runJob({ runDir, section: "bosses", lang: "enUS", env: { PATH: process.env.PATH }, tools }), 0);
  const log = readFileSync(join(runDir, "log"), "utf8");
  assert.match(log, /==> step 1\/1: bosses enUS --bump=patch/);
  assert.match(log, /to stderr/);
  assert.equal(readFileSync(join(runDir, "exit"), "utf8"), "0");
  assert.equal(existsSync(join(runDir, "work")), false);
});

test("the job forwards the team the release is for", async () => {
  const tools = fakeTools(`console.log("args: " + process.argv.slice(2).join(" "));`);
  const runDir = runDirectory();
  assert.equal(await runJob({ runDir, section: "places", lang: "deDE", bump: "minor", team: "stimmen", env: { PATH: process.env.PATH }, tools }), 0);
  assert.match(readFileSync(join(runDir, "log"), "utf8"), /^args: places deDE --bump=minor --team=stimmen$/m);
});

test("a run with no team, as one started before teams released, names none", async () => {
  const tools = fakeTools(`console.log("args: " + process.argv.slice(2).join(" "));`);
  const runDir = runDirectory();
  assert.equal(await runJob({ runDir, section: "places", lang: "deDE", env: { PATH: process.env.PATH }, tools }), 0);
  assert.match(readFileSync(join(runDir, "log"), "utf8"), /^args: places deDE --bump=patch$/m);
});

test("a staged release writes what it staged into the run's directory", async () => {
  const tools = fakeTools(`console.log("args: " + process.argv.slice(2).join(" "));`);
  const runDir = runDirectory();
  assert.equal(await runJob({ runDir, section: "places", lang: "deDE", team: "stimmen", stage: true, env: { PATH: process.env.PATH }, tools }), 0);
  const staged = join(runDir, "staged.json");
  assert.match(readFileSync(join(runDir, "log"), "utf8"), new RegExp(`^args: places deDE --bump=patch --team=stimmen --stage=${staged}$`, "m"));
});

for (const kind of ["promote", "delist"]) {
  test(`a ${kind} runs ${kind}.mjs on the input the site left in the run's directory`, async () => {
    const tools = fakeTools(`process.exit(9);`);
    writeFileSync(join(tools, `scripts/manager/${kind}.mjs`), `console.log("${kind}: " + process.argv.slice(2).join(" "));`);
    const runDir = runDirectory();
    assert.equal(await runJob({ runDir, kind, section: "places", lang: "deDE", team: "stimmen", env: { PATH: process.env.PATH }, tools }), 0);
    assert.match(readFileSync(join(runDir, "log"), "utf8"), new RegExp(`^${kind}: ${join(runDir, "input.json")}$`, "m"));
  });
}

test("a failing release is recorded, not thrown", async () => {
  const tools = fakeTools(`console.error("error: nope"); process.exit(3);`);
  const runDir = runDirectory();
  assert.equal(await runJob({ runDir, section: "bosses", lang: "enUS", env: {}, tools }), 3);
  assert.equal(readFileSync(join(runDir, "exit"), "utf8"), "3");
  assert.match(readFileSync(join(runDir, "log"), "utf8"), /error: nope/);
});

test("tools that cannot be copied still end the run, with the reason in the log", async () => {
  const runDir = runDirectory();
  assert.equal(await runJob({ runDir, section: "bosses", lang: "enUS", env: {}, tools: join(runDir, "absent") }), 1);
  assert.equal(readFileSync(join(runDir, "exit"), "utf8"), "1");
  assert.match(readFileSync(join(runDir, "log"), "utf8"), /^error: /);
});

test("the heartbeat moves while the release runs", async () => {
  const tools = fakeTools(`await new Promise((r) => setTimeout(r, 200));`);
  const runDir = runDirectory();
  const long_ago = new Date(Date.now() - 3_600_000);
  utimesSync(join(runDir, "heartbeat"), long_ago, long_ago);
  await runJob({ runDir, section: "bosses", lang: "enUS", env: {}, tools, beatMs: 20 });
  assert.ok(statSync(join(runDir, "heartbeat")).mtimeMs > long_ago.getTime() + 1000);
});

test("pruning keeps the newest runs", async () => {
  const runs = temp();
  for (const [name, age] of [["old", 3000], ["mid", 2000], ["new", 1000]]) {
    mkdirSync(join(runs, name));
    const at = new Date(Date.now() - age * 1000);
    utimesSync(join(runs, name), at, at);
  }
  await pruneRuns(runs, 2);
  assert.equal(existsSync(join(runs, "old")), false);
  assert.equal(existsSync(join(runs, "mid")), true);
  assert.equal(existsSync(join(runs, "new")), true);
});
