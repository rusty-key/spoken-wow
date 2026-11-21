/**
 * The `seen` envelope addons/Spoken_Quests/Contribute.lua writes (SeeSpeaker). The fixture comes
 * from tests/lua/quests_contribute_test.lua via `make contribute-fixtures`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checksum, parseEnvelope } from "./envelope";
import { isSightingEnvelope, sightingFrom } from "./sighting";

const captured = readFileSync(
  new URL("../../../../../tests/fixtures/contributions/captured-seen-npc.txt", import.meta.url),
  "utf8",
);

function seen(fields: string): string {
  const body = `!SPOKEN1 seen\naddon=SpokenQuests/9.9.9\nbuild=1.15.8/63829\n${fields}`;
  return `${body}sum=${checksum(body)}\n`;
}

describe("a sighting", () => {
  it("reads the envelope the addon writes", () => {
    expect(isSightingEnvelope(captured)).toBe(true);
    expect(sightingFrom(captured)).toEqual({ ok: true, value: { npcType: "creature", npcId: 12345, zones: [1411] } });
  });

  it("is no contribution", () => {
    expect(parseEnvelope(captured)).toEqual({ ok: false, error: "source" });
  });

  it("keeps each zone once, gameobjects too", () => {
    expect(sightingFrom(seen("npc=gameobject:7\nzones=1413,1411,1413\n"))).toEqual({
      ok: true,
      value: { npcType: "gameobject", npcId: 7, zones: [1413, 1411] },
    });
  });

  it("refuses what no game wrote", () => {
    for (const fields of [
      "npc=item:5\nzones=1411\n",
      "npc=creature:0\nzones=1411\n",
      "npc=creature:5 Thork\nzones=1411\n",
      "npc=creature:5\nzones=\n",
      "npc=creature:5\nzones=1411,Durotar\n",
      "npc=creature:5\nzones=1,2,3,4,5,6,7,8,9\n",
    ]) {
      expect(sightingFrom(seen(fields)).ok, fields).toBe(false);
    }
  });

  it("refuses one whose checksum does not match", () => {
    expect(sightingFrom(captured.replace("zones=1411", "zones=1413"))).toEqual({ ok: false, error: "checksum" });
  });

  it("tells a line from a sighting by the header alone", () => {
    expect(isSightingEnvelope(seen("npc=creature:5\nzones=1411\n"))).toBe(true);
    expect(isSightingEnvelope("!SPOKEN1 quests\nnpc=5\n")).toBe(false);
  });
});
