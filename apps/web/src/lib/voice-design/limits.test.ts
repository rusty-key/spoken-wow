import { describe, expect, it } from "vitest";

import { parseRemixSettings, PROMPT_ENDING, promptLengthProblem, promptProblems, recommendedPreview, withEnding } from "./limits";

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

  it("removes only the old sentence, never what the designer wrote after it", () => {
    const old = "Perfect audio quality, dry close-mic studio recording, no reverb or effects.";
    expect(withEnding(`A troll. ${old} Speaks slowly.`)).toBe(`A troll. Speaks slowly. ${PROMPT_ENDING}`);
  });

  it("checks the typed prompt's minimum and the sent prompt's maximum", () => {
    expect(promptLengthProblem("Hi")).toMatch(/20/);
    expect(promptLengthProblem("x".repeat(900))).toMatch(/1000/);
    expect(promptLengthProblem("x".repeat(500))).toBeNull();
    expect(promptLengthProblem(`${"x".repeat(840)} ${PROMPT_ENDING}`)).toBeNull();
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

describe("parseRemixSettings", () => {
  it("keeps the settings given, in range, and leaves the rest to ElevenLabs", () => {
    expect(parseRemixSettings({ promptStrength: 0.2, seed: 3 })).toEqual({ promptStrength: 0.2, guidanceScale: null, loudness: null, seed: 3 });
    expect(parseRemixSettings(undefined)).toEqual({ promptStrength: null, guidanceScale: null, loudness: null, seed: null });
  });

  it("names the setting out of range", () => {
    expect(parseRemixSettings({ promptStrength: 2 })).toMatch(/promptStrength/);
    expect(parseRemixSettings({ loudness: "loud" })).toMatch(/loudness/);
    expect(parseRemixSettings({ seed: 1.5 })).toMatch(/seed/);
    expect(parseRemixSettings({ seed: 4294967296 })).toMatch(/seed/);
    expect(parseRemixSettings({ seed: 4294967295 })).toMatchObject({ seed: 4294967295 });
  });
});
