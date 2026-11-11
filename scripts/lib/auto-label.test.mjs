import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_LABELED, NEEDS_TRIAGE, assignable, decide, isUntriaged, parseAnswer, pathLabels, pending, promptFor,
} from "./auto-label.mjs";

const labels = [{ name: "bug", description: "Something isn't working" }, { name: "Web UI", description: "" }];
const reply = (text, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });
const item = (names, created_at = "2026-11-09T00:00:00Z") => ({ created_at, labels: names.map((name) => ({ name })) });
const now = Date.parse("2026-11-09T12:00:00Z");

test("the real labeler config yields quoted and bare label names, and no glob or key below them", () => {
  const names = pathLabels(readFileSync(new URL("../../.github/labeler.yml", import.meta.url), "utf8"));
  assert.ok(names.includes("Addon / Spoken Player"));
  assert.ok(names.includes("Release & CI"));
  assert.ok(names.includes("Manager"));
  assert.ok(names.includes("documentation"));
  assert.ok(!names.includes("changed-files"));
  assert.equal(names.length, 10);
});

test("a path or source label alone leaves an item waiting; anything else means it was triaged", () => {
  const ignored = new Set(["from-discord", "Web UI"]);
  assert.equal(isUntriaged(item([]), ignored), true);
  assert.equal(isUntriaged(item(["from-discord", "Web UI"]), ignored), true);
  assert.equal(isUntriaged(item(["Web UI", "bug"]), ignored), false);
  assert.equal(isUntriaged(item([AUTO_LABELED]), ignored), false);
  assert.equal(isUntriaged(item([NEEDS_TRIAGE]), ignored), false);
});

test("old items are left alone, so the sweep cannot relabel the backlog", () => {
  const fresh = item([]);
  const old = item([], "2026-10-01T00:00:00Z");
  assert.deepEqual(pending([fresh, old], new Set(), now), [fresh]);
});

test("one sweep is capped, so a burst of spam cannot run up the bill", () => {
  const burst = Array.from({ length: 50 }, () => item([]));
  assert.equal(pending(burst, new Set(), now).length, 30);
});

test("the model is never offered a decision that belongs to a person", () => {
  const all = ["bug", "duplicate", "wontfix", "invalid", "from-discord", AUTO_LABELED, NEEDS_TRIAGE].map((name) => ({ name }));
  assert.deepEqual(assignable(all).map((l) => l.name), ["bug"]);
});

test("a confident answer is applied and marked as the machine's", () => {
  assert.deepEqual(decide({ labels: ["bug", "Web UI"], confident: true }, labels), ["bug", "Web UI", AUTO_LABELED]);
});

test("an unsure or empty answer asks a person instead of guessing", () => {
  assert.deepEqual(decide({ labels: ["bug"], confident: false }, labels), [NEEDS_TRIAGE]);
  assert.deepEqual(decide({ labels: [], confident: true }, labels), [NEEDS_TRIAGE]);
});

test("a label the repo does not offer is dropped, whatever the text talked the model into", () => {
  assert.deepEqual(decide({ labels: ["bug", "wontfix", "bug"], confident: true }, labels), ["bug", AUTO_LABELED]);
  assert.deepEqual(decide({ labels: ["wontfix"], confident: true }, labels), [NEEDS_TRIAGE]);
});

test("a refused, cut off or malformed reply counts as unsure rather than failing the sweep", () => {
  const unsure = { labels: [], confident: false };
  assert.deepEqual(parseAnswer(reply('{"labels":["bug"],"confident":true}')), { labels: ["bug"], confident: true });
  assert.deepEqual(parseAnswer(reply('{"labels":["bug"],"confident":true}', "refusal")), unsure);
  assert.deepEqual(parseAnswer(reply('{"labels":["bu', "max_tokens")), unsure);
  assert.deepEqual(parseAnswer(reply("not json")), unsure);
  assert.deepEqual(parseAnswer(reply('{"labels":"bug","confident":true}')), unsure);
  assert.deepEqual(parseAnswer({ stop_reason: "end_turn", content: [] }), unsure);
});

test("the prompt carries the files of a pull request and survives a missing body", () => {
  const pr = promptFor({ title: "T", body: null, pull_request: {} }, ["apps/web/a.ts"], labels);
  assert.match(pr, /pull request/);
  assert.match(pr, /apps\/web\/a\.ts/);
  assert.match(pr, /- bug: Something isn't working/);
  assert.match(pr, /- Web UI\n/);
  assert.doesNotMatch(promptFor({ title: "T", body: "b" }, null, labels), /changed_files/);
});
