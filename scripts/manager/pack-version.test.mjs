import { test } from "node:test";
import assert from "node:assert/strict";

import { bumpVersion, tocVersion, withTocVersion } from "./pack-version.mjs";

test("a bump resets what sits below it", () => {
  assert.equal(bumpVersion("2.5.3", "patch"), "2.5.4");
  assert.equal(bumpVersion("2.5.3", "minor"), "2.6.0");
  assert.equal(bumpVersion("2.5.3", "major"), "3.0.0");
});

test("a bump refuses what it cannot count from", () => {
  assert.throws(() => bumpVersion("2.5", "patch"), /not x\.y\.z/);
  assert.throws(() => bumpVersion("2.5.3", "huge"), /no such bump/);
});

test("the version line is read and replaced, keeping a Windows line ending", () => {
  const toc = "## Title: Pack\r\n## Version: 1.2.3\r\n## Notes: Version: 9.9.9\r\n";
  assert.equal(tocVersion(toc), "1.2.3");
  assert.equal(withTocVersion(toc, "1.2.4"), "## Title: Pack\r\n## Version: 1.2.4\r\n## Notes: Version: 9.9.9\r\n");
});

test("a .toc with no version line is an error", () => {
  assert.throws(() => tocVersion("## Title: Pack\n"), /no '## Version:' line/);
  assert.throws(() => withTocVersion("## Title: Pack\n", "1.0.0"), /no '## Version:' line/);
});
