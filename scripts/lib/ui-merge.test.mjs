import { test } from "node:test";
import assert from "node:assert/strict";

import { ciProblems, isUiPath, ownerVerdict, refusals, scopeProblems } from "./ui-merge.mjs";

const SHA = "abc123";
const green = ["Changed paths", "Addons (Lua)", "Quests pipeline (Python)", "Web", "Zones pipeline"]
  .map((name) => ({ name, status: "completed", conclusion: name === "Web" ? "success" : "skipped" }));
const pr = { state: "open", draft: false, base: { ref: "master" }, head: { sha: SHA }, changed_files: 1 };
const ui = { filename: "apps/web/src/components/Cell.tsx", status: "modified", patch: "+<div />" };
const api = { filename: "apps/web/src/app/api/users/route.ts", status: "modified", patch: "+x" };
const review = (state, commit_id = SHA, login = "rusty-key") => ({ state, commit_id, user: { login } });

test("only components, public assets and the global stylesheet are UI", () => {
  assert.equal(isUiPath("apps/web/src/components/ui/button.tsx"), true);
  assert.equal(isUiPath("apps/web/public/logo.png"), true);
  assert.equal(isUiPath("apps/web/src/app/globals.css"), true);
  assert.equal(isUiPath("apps/web/src/app/[lang]/page.tsx"), false);
  assert.equal(isUiPath("apps/web/migrations/001.sql"), false);
  assert.equal(isUiPath("apps/web/src/components-evil/x.ts"), false);
});

test("a UI change with green CI merges", () => {
  assert.deepEqual(refusals({ pr, files: [ui], checkRuns: green, reviews: [] }), []);
});

test("a file outside UI needs the owner's approval of the current commit", () => {
  const change = { pr, files: [api], checkRuns: green };
  assert.match(refusals({ ...change, reviews: [] })[0], /is not UI/);
  assert.match(refusals({ ...change, reviews: [review("APPROVED", "older")] })[0], /is not UI/);
  assert.match(refusals({ ...change, reviews: [review("APPROVED", SHA, "svengabr")] })[0], /is not UI/);
  assert.deepEqual(refusals({ ...change, reviews: [review("APPROVED")] }), []);
});

test("moving server code into components is not a UI change", () => {
  const moved = { ...ui, status: "renamed", previous_filename: "apps/web/src/lib/db.ts" };
  assert.match(scopeProblems([moved])[0], /lib\/db\.ts/);
});

test("server-only code added to a component is refused, and removing it is not", () => {
  for (const line of ['+"use server";', "+const key = process.env.KEY;", '+import { db } from "@/lib/db";',
    '+import { cookies } from "next/headers";', '+import { Pool } from "pg";']) {
    assert.match(scopeProblems([{ ...ui, patch: line }])[0], /server-only/, line);
  }
  assert.deepEqual(scopeProblems([{ ...ui, patch: "-const key = process.env.KEY;" }]), []);
});

test("code too big for a diff is refused, while a binary asset has none to give", () => {
  assert.match(scopeProblems([{ ...ui, patch: undefined }])[0], /no diff/);
  assert.deepEqual(scopeProblems([{ filename: "apps/web/public/logo.png", status: "added" }]), []);
});

test("every CI job must have finished without failing", () => {
  assert.deepEqual(ciProblems(green), []);
  assert.deepEqual(ciProblems(green.slice(1)), ["Changed paths has not run"]);
  const running = green.map((run) => (run.name === "Web" ? { ...run, status: "in_progress", conclusion: null } : run));
  assert.deepEqual(ciProblems(running), ["Web is still running"]);
  const failed = green.map((run) => (run.name === "Web" ? { ...run, conclusion: "failure" } : run));
  assert.deepEqual(ciProblems(failed), ["Web ended in failure"]);
});

test("the owner's approval does not excuse failing CI", () => {
  const failed = green.map((run) => (run.name === "Web" ? { ...run, conclusion: "failure" } : run));
  assert.deepEqual(refusals({ pr, files: [api], checkRuns: failed, reviews: [review("APPROVED")] }), ["Web ended in failure"]);
});

test("the owner's latest verdict stands, and a later comment does not change it", () => {
  assert.equal(ownerVerdict([review("APPROVED"), review("CHANGES_REQUESTED")]).state, "CHANGES_REQUESTED");
  assert.equal(ownerVerdict([review("CHANGES_REQUESTED"), review("COMMENTED")]).state, "CHANGES_REQUESTED");
  assert.match(refusals({ pr, files: [ui], checkRuns: green, reviews: [review("CHANGES_REQUESTED")] })[0], /requested changes/);
});

test("a closed, draft or wrongly based pull request is refused", () => {
  const check = (changes) => refusals({ pr: { ...pr, ...changes }, files: [ui], checkRuns: green, reviews: [] });
  assert.match(check({ state: "closed" })[0], /not open/);
  assert.match(check({ draft: true })[0], /draft/);
  assert.match(check({ base: { ref: "other" } })[0], /master/);
});

test("a file list shorter than the pull request is refused", () => {
  assert.match(refusals({ pr: { ...pr, changed_files: 4000 }, files: [ui], checkRuns: green, reviews: [] })[0], /could be listed/);
});
