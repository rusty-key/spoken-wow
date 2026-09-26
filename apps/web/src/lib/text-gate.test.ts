import { describe, expect, it } from "vitest";
import { hasInvalidChars, isVoiceable } from "./text-gate";

describe("hasInvalidChars", () => {
  it("catches the template tokens the game expands and we do not", () => {
    expect(hasInvalidChars("It should all arrive in less than $2113w days.")).toBe(true);
    expect(hasInvalidChars("Hi $N.")).toBe(true);
  });

  it("no longer catches a capitalised stage direction, which the narrator reads", () => {
    expect(hasInvalidChars("<Thrall grunts.>")).toBe(false);
  });

  it("no longer catches a lowercase sound, which becomes an audio tag", () => {
    expect(hasInvalidChars("<cough>")).toBe(false);
  });

  it("still catches a bracket nothing can take", () => {
    // Unbalanced is simply damage.
    expect(hasInvalidChars("What < is this")).toBe(true);
  });

  it("passes ordinary text, punctuation and apostrophe names alike", () => {
    expect(hasInvalidChars("I hate those nasty timber wolves!")).toBe(false);
    expect(hasInvalidChars("Kel'Thuzad -- the lich -- waits.")).toBe(false);
  });
});

describe("isVoiceable", () => {
  it("rescues an invalid-chars line whose text has been rewritten", () => {
    const line = { skipReason: "invalid-chars" };
    expect(isVoiceable(line, "Meet me in $B Ironforge")).toBe(false);
    expect(isVoiceable(line, "Meet me in Ironforge")).toBe(true);
  });

  it("voices a capitalised stage direction, which the narrator reads", () => {
    // Was refused until the narrator existed to read it. lib/generation/narration.ts splits it
    // out; here it only has to stop counting as damage.
    expect(isVoiceable({ skipReason: "invalid-chars" }, "<Thrall grunts.>")).toBe(true);
    expect(isVoiceable({ skipReason: "invalid-chars" }, "Excellent. <He reads.>")).toBe(true);
  });

  it("voices a lowercase sound, which the NPC performs as an audio tag", () => {
    // <hic> is the NPC hiccuping. lib/generation/narration.ts turns it into [hic], which
    // eleven_v3 performs; the gate only has to stop counting it as damage.
    expect(isVoiceable({ skipReason: "invalid-chars" }, "Ye're brave... <cough>...")).toBe(true);
  });

  it("still refuses an unbalanced bracket", () => {
    expect(isVoiceable({ skipReason: "invalid-chars" }, "What < is this")).toBe(false);
  });

  it("still refuses a template token beside a direction", () => {
    expect(isVoiceable({ skipReason: "invalid-chars" }, "Hello $2113w. <He waves.>")).toBe(false);
  });

  it("voices progress text, which is skipped by nothing but damage", () => {
    expect(isVoiceable({ skipReason: null }, "Did you find it yet?")).toBe(true);
  });

  it("still refuses a clean line that an override has broken", () => {
    expect(isVoiceable({ skipReason: null }, "Meet me in $B Ironforge")).toBe(false);
  });

  it("passes a line the corpus already voices", () => {
    expect(isVoiceable({ skipReason: null }, "Meet me in Ironforge.")).toBe(true);
  });
});

describe("a line another language has not translated", () => {
  it("is never voiceable, whatever English it is carrying", () => {
    expect(isVoiceable({ skipReason: "untranslated" }, "Well met, traveller.")).toBe(false);
  });
});
