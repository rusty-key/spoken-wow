/**
 * The `seen` envelope addons/Spoken_Quests/Contribute.lua writes (SeeSpeaker). The fixture comes
 * from tests/lua/quests_contribute_test.lua via `make contribute-fixtures`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checksum, parseEnvelope, parseGatheredEnvelope, type Envelope } from "./envelope";
import { sightingFrom } from "./sighting";

const captured = readFileSync(
  new URL("../../../../../tests/fixtures/contributions/captured-seen-npc.txt", import.meta.url),
  "utf8",
);

function seen(fields: string): string {
  const body = `!SPOKEN1 seen\naddon=SpokenQuests/9.9.9\nbuild=1.15.8/63829\n${fields}`;
  return `${body}sum=${checksum(body)}\n`;
}

function read(raw: string) {
  const parsed = parseGatheredEnvelope(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.source).toBe("seen");
  return sightingFrom(parsed.value as Envelope<"seen">);
}

describe("a sighting", () => {
  it("reads the envelope the addon writes", () => {
    expect(read(captured)).toEqual({
      npcType: "creature",
      npcId: 12345,
      zones: [1411],
      locale: "enUS",
      name: "Deathguard Linnea",
    });
  });

  it("reads an older addon's, which has no locale and no name", () => {
    expect(read(seen("npc=creature:5\nzones=1411\n"))).toEqual({
      npcType: "creature",
      npcId: 5,
      zones: [1411],
      locale: null,
      name: null,
    });
  });

  it("drops a name no game shows, and keeps where the NPC was met", () => {
    expect(read(seen(`locale=esMX\nnpc=creature:5\nzones=1411\nname=${"a".repeat(201)}\n`))).toMatchObject({
      zones: [1411],
      locale: "esMX",
      name: null,
    });
  });

  it("is gathered, but no contribution", () => {
    expect(parseEnvelope(captured)).toEqual({ ok: false, error: "source" });
  });

  it("keeps each zone once, gameobjects too", () => {
    expect(read(seen("npc=gameobject:7\nzones=1413,1411,1413\n"))).toMatchObject({
      npcType: "gameobject",
      npcId: 7,
      zones: [1413, 1411],
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
      "npc=creature:2147483648\nzones=1411\n",
      "npc=creature:5\nzones=2147483648\n",
    ]) {
      expect(read(seen(fields)), fields).toBeNull();
    }
  });

  it("refuses one whose checksum does not match", () => {
    expect(parseGatheredEnvelope(captured.replace("zones=1411", "zones=1413"))).toEqual({ ok: false, error: "checksum" });
  });
});
