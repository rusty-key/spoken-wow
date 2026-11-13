import { test } from "node:test";
import assert from "node:assert/strict";

import { problems, section } from "./changelog.mjs";

const CHANGELOG = [
  "# Changelog — Spoken",
  "",
  "## Unreleased",
  "",
  "- **Something new.** *([Nucabe](https://github.com/Nucabe))*",
  "",
  "## 3.4.0 — 2026-10-12",
  "",
  "- **A change.** *([Nucabe](https://github.com/Nucabe))*",
  "",
  "## 3.3.1 — 2026-10-11",
  "",
  "- **An older one.**",
  "",
].join("\n");

test("a version's section runs from its heading to the next", () => {
  assert.equal(
    section(CHANGELOG, "3.4.0"),
    "## 3.4.0 — 2026-10-12\n\n- **A change.** *([Nucabe](https://github.com/Nucabe))*",
  );
});

test("a version is matched whole, so 3.4 is not 3.4.0", () => {
  assert.throws(() => section(CHANGELOG, "3.4"), /no "## 3.4" section/);
});

test("a release whose notes are still under Unreleased has no section", () => {
  assert.throws(() => section(CHANGELOG, "3.5.0"), /no "## 3.5.0" section/);
});

test("two sections for one version are refused", () => {
  assert.throws(() => section(`${CHANGELOG}## 3.4.0 — again\n`, "3.4.0"), /two "## 3.4.0" sections/);
});

test("a changelog checked out with CRLF reads the same", () => {
  assert.equal(section(CHANGELOG.replace(/\n/g, "\r\n"), "3.3.1"), "## 3.3.1 — 2026-10-11\n\n- **An older one.**");
});

test("a changelog that keeps the rules has no problems", () => {
  const credited = CHANGELOG.replace("- **An older one.**", "- **An older one.** *([Rusty](https://github.com/rusty-key))*");
  assert.deepEqual(problems(credited, ["3.4.0", "3.3.1"]), []);
});

test("an Unreleased bullet without a credit is named, over however many lines it runs", () => {
  const text = CHANGELOG.replace(
    "- **Something new.** *([Nucabe](https://github.com/Nucabe))*",
    "- **Something new.**\n  On two lines.\n- **Credited.**\n  *([Nucabe](https://github.com/Nucabe))*",
  );
  const found = problems(text);
  assert.equal(found.length, 1);
  assert.match(found[0], /line 5: an Unreleased bullet with no credit: - \*\*Something new/);
});

test("released sections are history, credited or not", () => {
  assert.deepEqual(problems(CHANGELOG, ["3.3.1"]), []);
});

test("a shipped version with no section of its own has its notes still under Unreleased", () => {
  assert.deepEqual(problems(CHANGELOG, ["3.5.0"]), ['3.5.0 has shipped but has no "## 3.5.0" section']);
});

test("a version heading inside Unreleased is named, groups that are not versions are not", () => {
  const grouped = CHANGELOG.replace("## Unreleased\n\n", "## Unreleased\n\n### Settings\n\n");
  assert.deepEqual(problems(grouped, ["3.4.0"]), []);
  const copied = CHANGELOG.replace("## Unreleased\n\n", "## Unreleased\n\n### 3.4.0 notes\n\n");
  const found = problems(copied, ["3.4.0"]);
  assert.equal(found.length, 1);
  assert.match(found[0], /line 5: "### 3\.4\.0 notes" is a version heading under Unreleased/);
});

test("Unreleased comes first", () => {
  const late = CHANGELOG.replace("## Unreleased\n\n- **Something new.** *([Nucabe](https://github.com/Nucabe))*\n\n", "")
    .replace("## 3.3.1", "## Unreleased\n\n## 3.3.1");
  assert.match(problems(late).join("\n"), /"## Unreleased" is not the first section/);
});
