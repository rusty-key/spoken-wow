import { describe, expect, it } from "vitest";

import { newVoiceName, Roster, type RosterData } from "./roster";

const DATA: RosterData = {
  races: [
    { key: "orc", genders: ["female", "male"] },
    { key: "bloodelf", genders: ["female"] },
    { key: "gameobject", genders: [] },
    { key: "treant", genders: [] },
  ],
  flavors: [
    { race: "orc", gender: "male", flavor: "shady" },
    { race: "orc", gender: "male", flavor: "guard" },
    { race: "treant", gender: null, flavor: "ancient" },
  ],
  voices: [
    { name: "orc-male-shady", race: "orc", gender: "male" },
    { name: "orc-male-guard", race: "orc", gender: "male" },
    { name: "bloodelf-female", race: "bloodelf", gender: "female" },
    { name: "narrator-male", race: "narrator", gender: "male" },
    { name: "treant", race: "treant", gender: "" },
  ],
  assignments: [
    { race: "orc", gender: "male", flavor: "shady", voice: "orc-male-shady" },
    { race: "orc", gender: "male", flavor: "guard", voice: "orc-male-guard" },
    { race: "bloodelf", gender: "female", flavor: null, voice: "bloodelf-female" },
    { race: "gameobject", gender: null, flavor: null, voice: "narrator-male" },
    { race: "treant", gender: null, flavor: null, voice: "treant" },
  ],
};
const roster = new Roster(DATA);

describe("Roster", () => {
  it("finds the most specific assignment", () => {
    expect(roster.voiceFor("orc", "male", "shady")).toBe("orc-male-shady");
    expect(roster.voiceFor("bloodelf", "female", null)).toBe("bloodelf-female");
    expect(roster.voiceFor("gameobject", null, null)).toBe("narrator-male");
    expect(roster.voiceFor("treant", null, "ancient")).toBe("treant");
    expect(roster.voiceFor("orc", "male", null)).toBeNull();
    expect(roster.voiceFor(null, "male", null)).toBeNull();
  });

  it("answers a model slot with itself", () => {
    expect(roster.voiceFor("model-29", "male", null)).toBe("model-29");
    expect(roster.isVoice("model-29")).toBe(true);
  });

  it("knows genderless races", () => {
    expect(roster.isGenderless("treant")).toBe(true);
    expect(roster.isGenderless("orc")).toBe(false);
    expect(roster.gendersOf("orc")).toEqual(["female", "male"]);
  });

  it("names the family a voice's files hash by", () => {
    expect(roster.familyOf("narrator-male")).toEqual({ race: "narrator", gender: "male" });
    expect(roster.familyOf("treant")).toEqual({ race: "treant", gender: "" });
    expect(roster.familyOf("nosuch")).toBeNull();
  });

  it("refuses a gender on a genderless race, a missing gender and an unknown flavor", () => {
    expect(roster.isAnswer("treant", "male", null)).toMatch(/no gender/);
    expect(roster.isAnswer("orc", null, null)).toMatch(/needs a gender/);
    expect(roster.isAnswer("orc", "male", "zany")).toMatch(/flavor/);
    expect(roster.isAnswer("nosuch", null, null)).toMatch(/type/);
    expect(roster.isAnswer("orc", "male", "shady")).toBeNull();
    expect(roster.isAnswer("treant", null, "ancient")).toBeNull();
    expect(roster.isAnswer(null, null, null)).toBeNull();
  });

  it("names a new voice after its combination", () => {
    expect(newVoiceName("treant", null, null)).toBe("treant");
    expect(newVoiceName("orc", "male", "shady")).toBe("orc-male-shady");
    expect(newVoiceName("treant", null, "ancient")).toBe("treant-ancient");
  });
});
