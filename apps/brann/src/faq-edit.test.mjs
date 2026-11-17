import assert from "node:assert/strict";
import { test } from "node:test";

import { applyChanges, evidenceLinks, parseFaq, prBody, renderFaq } from "./faq-edit.mjs";
import { loadFaq } from "./support.mjs";

const FAQ = "# FAQ\n\nIntro.\n\n## One?\n\nFirst.\n\n## Two?\n\n- a\n- b\n";

test("parse and render give back the same FAQ, the real one included", () => {
  assert.equal(renderFaq(parseFaq(FAQ)), FAQ);
  assert.equal(renderFaq(parseFaq(loadFaq())), loadFaq());
  assert.deepEqual(parseFaq(FAQ).entries.map((e) => e.heading), ["One?", "Two?"]);
});

test("changes add after a heading, edit and rename, and remove", () => {
  const { text, applied, skipped } = applyChanges(FAQ, [
    { action: "add", heading: "Between?", after: "One?", body: "New." },
    { action: "edit", heading: "Two?", new_heading: "Second?", body: "Changed." },
    { action: "remove", heading: "One?" },
  ]);
  assert.equal(text, "# FAQ\n\nIntro.\n\n## Between?\n\nNew.\n\n## Second?\n\nChanged.\n");
  assert.equal(applied.length, 3);
  assert.deepEqual(skipped, []);
});

test("a change that does not fit is skipped, not guessed", () => {
  const { text, skipped } = applyChanges(FAQ, [
    { action: "edit", heading: "Missing?", body: "x" },
    { action: "add", heading: "One?", body: "dup" },
    { action: "add", heading: "Empty?", body: " " },
  ]);
  assert.equal(text, FAQ);
  assert.deepEqual(skipped.map((s) => s.why), ["no entry has that heading", "an entry with that heading exists", "no text"]);
});

test("evidence becomes links, and anything else is dropped", () => {
  const messages = new Map([["m3", "https://discord.com/channels/1/2/3"]]);
  assert.deepEqual(evidenceLinks(["m3", "abc1234def", "m9", "made-up"], { messages, repo: "o/r" }), [
    "[m3](https://discord.com/channels/1/2/3)",
    "[abc1234](https://github.com/o/r/commit/abc1234def)",
  ]);
});

test("the PR body lists each change with its reason, warns on a failing check, and lists skips", () => {
  const body = prBody({
    applied: [{ action: "edit", heading: "Two?", new_heading: "Second?", reason: "A setting was renamed.", evidence: ["m3"] }],
    skipped: [{ change: { action: "remove", heading: "Gone?", reason: "Feature removed." }, why: "no entry has that heading" }],
    problems: ['"Second?": **Old Name** is in no English UI string'],
    days: 7,
    links: (refs) => refs.map((r) => `[${r}](x)`),
    footer: "FOOTER",
  });
  assert.match(body, /### Edit: Two\? → Second\?\n\nA setting was renamed\.\n\nEvidence: \[m3\]\(x\)/);
  assert.match(body, /> \[!WARNING\][\s\S]*\*\*Old Name\*\*/);
  assert.match(body, /- Remove "Gone\?": no entry has that heading\. Feature removed\./);
  assert.match(body, /FOOTER\n$/);
});
