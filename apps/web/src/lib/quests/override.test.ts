import { describe, expect, it } from "vitest";
import { MAX_OVERRIDE_LENGTH, OverrideError, overrideOf, validateOverride, validateRewrite, type LineOverride } from "./override";

const VALID = { file: "quests/1155-accept.mp3", lineId: "q:1155:accept", text: "  A crystal fragment.  " };

describe("validateOverride", () => {
  it("trims the text it will send", () => {
    expect(validateOverride(VALID).text).toBe("A crystal fragment.");
  });

  it("refuses an empty rewrite, and says what to do instead", () => {
    expect(() => validateOverride({ ...VALID, text: "   " })).toThrow(/remove the override/);
  });

  it("refuses the characters an override exists to remove", () => {
    expect(() => validateOverride({ ...VALID, text: "what < is this" })).toThrow(OverrideError);
    expect(() => validateOverride({ ...VALID, text: "in $2113w days" })).toThrow(/unvoiceable/);
  });

  it("refuses a $g branch, which no one file can say", () => {
    expect(() => validateOverride({ ...VALID, text: "Well met, $glad:lass;." })).toThrow(/unvoiceable/);
  });
});

describe("validateRewrite", () => {
  it("accepts a $g branch, the route's to split, but nothing else of the token's kind", () => {
    expect(() => validateRewrite({ ...VALID, text: "Well met, $glad:lass;." })).not.toThrow();
    expect(() => validateRewrite({ ...VALID, text: "Well met, $glad:lass;, $N." })).toThrow(/unvoiceable/);
  });

  it("accepts either bracketed span, which the narrator and the NPC now voice", () => {
    // The gate stopped calling these damage, and an override is judged by the same gate.
    expect(() => validateOverride({ ...VALID, text: "<Thrall grunts.>" })).not.toThrow();
    expect(() => validateOverride({ ...VALID, text: "<cough> ye brave soul" })).not.toThrow();
  });

  it("refuses a paste", () => {
    const text = "a".repeat(MAX_OVERRIDE_LENGTH + 1);
    expect(() => validateOverride({ ...VALID, text })).toThrow(/too long/);
  });

  it("requires both halves of the identity", () => {
    expect(() => validateOverride({ ...VALID, file: "" })).toThrow(/file is required/);
    expect(() => validateOverride({ ...VALID, lineId: "" })).toThrow(/lineId is required/);
    expect(() => validateOverride(null)).toThrow(OverrideError);
  });
});

describe("overrideOf", () => {
  const override = (file: string): LineOverride => ({ file, lineId: "q:5:accept", text: "Fixed.", updatedAt: "", updatedBy: null });
  const overrides = new Map([["quests/5-accept.mp3", override("quests/5-accept.mp3")]]);

  it("gives a voice's file its line's override", () => {
    expect(overrideOf(overrides, "quests/5-accept.mp3")?.text).toBe("Fixed.");
    expect(overrideOf(overrides, "quests/5-accept-human-male-warrior.mp3")?.text).toBe("Fixed.");
  });

  it("prefers an override saved against the voice's own file", () => {
    const own = new Map(overrides).set("quests/5-accept-human-male-warrior.mp3", { ...override("x"), text: "Own." });
    expect(overrideOf(own, "quests/5-accept-human-male-warrior.mp3")?.text).toBe("Own.");
  });

  it("gives the file of a voice an admin added its line's override", () => {
    expect(overrideOf(overrides, "quests/5-accept-treant.mp3")?.text).toBe("Fixed.");
  });

  it("finds nothing for another line's file", () => {
    expect(overrideOf(overrides, "quests/6-accept-human-male-warrior.mp3")).toBeUndefined();
  });
});

describe("a rewrite's tokens", () => {
  const body = (text: string) => ({ file: "quests/1-accept.mp3", lineId: "q:1:accept", text });

  it("lets a language keep the tokens it speaks", () => {
    expect(validateRewrite(body("Gut gemacht, $C."), "deDE").text).toBe("Gut gemacht, $C.");
    expect(validateOverride(body("Gut gemacht, $C."), "deDE").text).toBe("Gut gemacht, $C.");
  });

  it("refuses a $g branch in one file there too", () => {
    expect(() => validateOverride(body("Gut, $gHerr:Dame;."), "deDE")).toThrow(/unvoiceable/);
  });

  it("still refuses a token glued to a word", () => {
    expect(() => validateRewrite(body("Gut gemacht, $Nama."), "deDE")).toThrow(OverrideError);
  });
});
