import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { modelForDisplay, voiceForDisplay, voiceFromDisplays } from "./display-voices";

// Appearance ids from the 1.60.1 client, as its creature cache reported them for real NPCs.
describe("voiceForDisplay", () => {
  it("takes a named voice set on the roster as exact", async () => {
    // Boarton Shadetotem: a tauren speaking in taurenmalewarriornpc's voice.
    expect(await voiceForDisplay(112671)).toMatchObject({
      voice: { race: "tauren", gender: "male", flavor: "warrior" },
      exact: true,
    });
  });

  it("matches a set the roster names by id", async () => {
    // Halaan Hawk-Eye.
    expect(await voiceForDisplay(143583)).toMatchObject({
      voice: { race: "skybourneelf", gender: "male", flavor: "3776" },
      exact: true,
    });
  });

  it("lets the voice set decide over the model", async () => {
    // Elatrell Featherlight is drawn as a blood elf and greets you in the Skybourne male voice.
    expect(await voiceForDisplay(136967)).toMatchObject({
      voice: { race: "skybourneelf", gender: "male", flavor: "3776" },
    });
  });

  it("answers no flavor only while a voice reads the race-gender without one", async () => {
    // 4730: a blood elf woman, no voice set named.
    expect(await voiceForDisplay(4730)).toMatchObject({ voice: { race: "bloodelf", gender: "female", flavor: null } });
    // As the Types tab maps bloodelf-female into a first flavor: the voice stays, read by the flavor.
    await db().query(`insert into "flavor" ("race", "gender", "flavor") values ('bloodelf', 'female', 'testnoble')`);
    await db().query(
      `update "voice_assignment" set "flavor" = 'testnoble'
        where "race" = 'bloodelf' and "gender" = 'female' and "flavor" is null`,
    );
    try {
      expect(await voiceForDisplay(4730)).toMatchObject({
        voice: { race: "bloodelf", gender: "female", flavor: "testnoble" },
      });
    } finally {
      await db().query(
        `update "voice_assignment" set "flavor" = null
          where "race" = 'bloodelf' and "gender" = 'female' and "flavor" = 'testnoble'`,
      );
      await db().query(`delete from "flavor" where "flavor" = 'testnoble'`);
    }
  });

  it("answers nothing, with a reason, for an appearance it has no record of", async () => {
    expect(await voiceForDisplay(999_999_999)).toMatchObject({ voice: null, reason: expect.stringMatching(/no model/) });
  });
});

// Bluffwatcher (3084): two male appearances and two female, as twelve SetCreature rolls in the
// 1.60.1 client reported them. 122055 and 121961 are the model files the addon reports for
// tauren male and female.
describe("voiceFromDisplays", () => {
  it("keeps the appearances drawn with the body the player saw", async () => {
    expect(await voiceFromDisplays([2141, 8572, 9391, 9392], 122055)).toEqual({
      exact: true,
      voice: { race: "tauren", gender: "male", flavor: "warrior" },
    });
    expect(await voiceFromDisplays([2141, 8572, 9391, 9392], 121961)).toEqual({
      exact: true,
      voice: { race: "tauren", gender: "female", flavor: "official" },
    });
  });

  it("knows nothing when two bodies remain and no model says which", async () => {
    expect(await voiceFromDisplays([2141, 9392], null)).toBe(null);
  });

  // Hamish Bergwort's four appearances are all the same dwarf female body, with three voices.
  it("narrows to the voices on offer when one body has several", async () => {
    expect(await voiceFromDisplays([36630, 140654, 144322, 146689], modelForDisplay(36630))).toEqual({
      exact: false,
      race: "dwarf",
      gender: "female",
      flavors: ["guard", "maternal", "young"],
    });
  });

  it("compares bodies by the appearance's model, not by whose voice it borrows", async () => {
    // Elatrell Featherlight: a blood elf body greeting in the Skybourne male voice.
    expect(await voiceFromDisplays([136967], modelForDisplay(136967))).toMatchObject({
      exact: true,
      voice: { race: "skybourneelf", gender: "male", flavor: "3776" },
    });
  });

  it("knows nothing about appearances it has no record of", async () => {
    expect(await voiceFromDisplays([999_999_999], 122055)).toBe(null);
  });
});

afterAll(closeDb);
