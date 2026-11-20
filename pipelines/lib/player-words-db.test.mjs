import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRows } from "./player-words-db.mjs";
import { registerPlayerWords, speakPlayerTokens } from "./player-words.mjs";

test("a build speaks a team's language in the words its row holds", () => {
  const rows = parseRows(
    'xxXX|{"m": {"name": "nhà thám hiểm", "race": "lữ khách"}, "f": {"name": "nhà thám hiểm", "race": "lữ khách"}}\n',
  );
  registerPlayerWords(rows);
  try {
    assert.equal(speakPlayerTokens("$R, hãy đi đi.", "xxXX"), "Lữ khách, hãy đi đi.");
  } finally {
    registerPlayerWords([]);
  }
  assert.equal(speakPlayerTokens("$R, hãy đi đi.", "xxXX"), "$R, hãy đi đi.");
});
