import { test } from "node:test";
import assert from "node:assert/strict";

import { namedBy } from "./relevant.mjs";

const relevant = namedBy(["quests/5-accept", "gossip/abc", "followup/4377-dwarf-male-standard"]);

test("a file a current line names, and its other voices, are carried", () => {
  assert.equal(relevant("quests/5-accept"), true);
  assert.equal(relevant("quests/5-accept-human-male-warrior"), true);
  assert.equal(relevant("followup/4377-dwarf-male-standard-human-male-warrior"), true);
});

test("a player-gender file of a moment the language has as one line is not", () => {
  assert.equal(relevant("gossip/m-abc"), false);
  assert.equal(relevant("gossip/f-abc-human-male-warrior"), false);
  assert.equal(relevant("quests/5-complete"), false);
});
