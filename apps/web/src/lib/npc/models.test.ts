import { describe, expect, it } from "vitest";

import { raceForModel } from "./models";

describe("raceForModel", () => {
  // The model the live client reported for a tauren NPC, resolved against the community
  // listfile: character/tauren/male/taurenmale.m2.
  it("resolves the model a real client reported", () => {
    expect(raceForModel(122055)).toEqual({ race: "tauren", gender: "male" });
  });

  it("resolves the HD variant of a race to the same race", () => {
    expect(raceForModel(968705)).toEqual({ race: "tauren", gender: "male" });
  });

  it("resolves a race the corpus has no voices for, because triage still wants to know", () => {
    expect(raceForModel(1022598)).toEqual({ race: "draenei", gender: "female" });
  });

  // The Forever client's Skybourne bodies. Without them a Skybourne NPC whose appearance has
  // no voice set (Quel'ana Quickgale) resolved to no race at all.
  it("resolves the Skybourne elf bodies", () => {
    expect(raceForModel(7478487)).toEqual({ race: "skybourneelf", gender: "male" });
    expect(raceForModel(7478494)).toEqual({ race: "skybourneelf", gender: "female" });
  });

  it("answers nothing for a creature model that is not a character", () => {
    // A murloc, a dragon, an elemental: a normal outcome, not an error.
    expect(raceForModel(1)).toBe(null);
  });

  it("answers nothing for a missing id", () => {
    expect(raceForModel(0)).toBe(null);
  });
});
