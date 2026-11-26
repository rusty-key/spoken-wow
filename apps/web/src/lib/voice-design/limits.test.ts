import { describe, expect, it } from "vitest";

import { PROMPT_ENDING, promptProblems, recommendedPreview, withEnding } from "./limits";

const m = (ess: number, decay: number, level: number) => ({ ess, decay, level });

describe("recommendedPreview", () => {
  it("takes the softest s among previews with little room and a full level", () => {
    // Preview 0 is softest but echoes; preview 2 is soft and dry but 7 dB quieter than the loudest.
    expect(recommendedPreview([m(0.01, -12, -14), m(0.18, -20, -12), m(0.02, -21, -19)])).toBe(1);
  });

  it("falls back to the softest s when none passes", () => {
    expect(recommendedPreview([m(0.74, -10, -12), m(0.18, -12, -13), m(0.7, -11, -12)])).toBe(1);
  });

  it("counts a room tail of exactly -17 dB and a level exactly 6 dB down as passing", () => {
    expect(recommendedPreview([m(0.5, -20, -10), m(0.1, -17, -16)])).toBe(1);
  });

  it("recommends nothing without measurements", () => {
    expect(recommendedPreview([null, { ess: 0.1 }, null])).toBeNull();
  });
});

describe("the prompt's ending", () => {
  it("replaces the old studio sentence with the required ending", () => {
    const old = "A gruff orc. General American accent. Perfect audio quality, dry close-mic studio recording, no reverb or effects.";
    expect(withEnding(old)).toBe(`A gruff orc. General American accent. ${PROMPT_ENDING}`);
    expect(withEnding(`A gruff orc. ${PROMPT_ENDING}`)).toBe(`A gruff orc. ${PROMPT_ENDING}`);
  });

  it("names what makes s sounds harsh, and a missing ending", () => {
    expect(promptProblems("A troll with crisp, snappy consonants and a hissing voice.")).toEqual({
      missingEnding: true,
      words: ["crisp", "hissing", "snappy consonants"],
    });
    expect(promptProblems(`A troll. ${PROMPT_ENDING}`)).toEqual({ missingEnding: false, words: [] });
  });

  it("is the agreed sentence, verbatim", () => {
    expect(PROMPT_ENDING).toBe(
      "Soft, gentle s sounds. Clean professional audiobook recording, close to a warm studio microphone, natural and full-bodied, no harshness, no room echo.",
    );
  });
});
