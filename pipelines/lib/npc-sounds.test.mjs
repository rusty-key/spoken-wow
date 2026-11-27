import assert from "node:assert/strict";
import test from "node:test";

import { buildNpcSounds } from "./npc-sounds.mjs";

const set = (ID, greeting, farewell, pissed) => ({
  ID: String(ID),
  SoundID_0: String(greeting),
  SoundID_1: String(farewell),
  SoundID_2: String(pissed),
  SoundID_3: "0",
});
const file = (SoundKitID, FileDataID) => ({ SoundKitID: String(SoundKitID), FileDataID: String(FileDataID) });

test("each voice set lists its greeting, farewell and pissed files", () => {
  const sets = buildNpcSounds({
    npcSounds: [set(57, 6027, 6028, 6029)],
    kitEntries: [file(6027, 557764), file(6027, 557765), file(6028, 557771), file(6029, 557766)],
    voices: { 57: "orc-female-standard" },
  });
  assert.deepEqual(sets, {
    57: { voice: "orc-female-standard", greeting: [557764, 557765], farewell: [557771], pissed: [557766] },
  });
});

test("a shopkeeper's set keeps its own greeting and shares the rest", () => {
  const sets = buildNpcSounds({
    npcSounds: [set(57, 6027, 6028, 6029), set(124, 6646, 6028, 6029)],
    kitEntries: [file(6027, 557764), file(6646, 557764), file(6646, 557774), file(6028, 557771)],
    voices: {},
  });
  assert.deepEqual(sets[124].greeting, [557764, 557774]);
  assert.deepEqual(sets[124].farewell, sets[57].farewell);
});

test("a set the voices do not name keeps its id and no voice", () => {
  const sets = buildNpcSounds({ npcSounds: [set(3776, 1, 0, 0)], kitEntries: [file(1, 10)], voices: {} });
  assert.deepEqual(sets[3776], { voice: null, greeting: [10], farewell: [], pissed: [] });
});

test("files come out sorted and once each, whatever order the table lists them in", () => {
  const sets = buildNpcSounds({
    npcSounds: [set(1, 5, 0, 0)],
    kitEntries: [file(5, 30), file(5, 10), file(5, 30)],
    voices: {},
  });
  assert.deepEqual(sets[1].greeting, [10, 30]);
});

test("a set with no sounds at all is left out", () => {
  assert.deepEqual(buildNpcSounds({ npcSounds: [set(2, 0, 0, 0)], kitEntries: [], voices: {} }), {});
});
