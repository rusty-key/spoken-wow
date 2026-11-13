import { describe, expect, it } from "vitest";

import { madeByFacets, madeByMatches, madeByOf, modelLabel } from "./made-by";

describe("modelLabel", () => {
  it("drops the prefix that only repeats the provider", () => {
    expect(modelLabel("elevenlabs", "eleven_v3")).toBe("eleven:v3");
    expect(modelLabel("elevenlabs", "eleven_multilingual_v2")).toBe("eleven:multilingual_v2");
  });

  it("drops fish's family letter, and leaves a named model alone", () => {
    expect(modelLabel("fish", "s2.1-pro-free")).toBe("fish:2.1-pro-free");
    expect(modelLabel("fish", "drama-3-preview")).toBe("fish:drama-3-preview");
  });

  /** Every clip the CLI imported recorded no model, and ElevenLabs has never had just one. */
  it("says unknown rather than nothing when no model was recorded", () => {
    expect(modelLabel("elevenlabs", null)).toBe("eleven:unknown");
  });
});

describe("madeByFacets", () => {
  it("lists each model and author once, sorted", () => {
    const made = [
      madeByOf({ provider: "fish", modelId: "s2.1-pro-free", createdBy: "u2", createdByName: "Zed", createdAt: new Date("2026-10-01T12:00:00Z") }),
      madeByOf({ provider: "elevenlabs", modelId: "eleven_v3", createdBy: "u1", createdByName: "Amy", createdAt: new Date("2026-10-01T12:00:00Z") }),
      madeByOf({ provider: "fish", modelId: "s2.1-pro-free", createdBy: "u1", createdByName: "Amy", createdAt: new Date("2026-10-01T12:00:00Z") }),
      madeByOf({ provider: "elevenlabs", modelId: null, createdBy: null, createdByName: null, createdAt: new Date("2026-10-01T12:00:00Z") }),
    ];
    expect(madeByFacets(made)).toEqual({
      models: ["eleven:unknown", "eleven:v3", "fish:2.1-pro-free"],
      authors: [
        { id: "u1", name: "Amy" },
        { id: "u2", name: "Zed" },
      ],
    });
  });
});

describe("madeByMatches", () => {
  const made = madeByOf({ provider: "fish", modelId: "s2.1-pro-free", createdBy: "u1", createdByName: "Amy", createdAt: new Date("2026-10-01T12:00:00Z") });

  it("passes everything with no filter set", () => {
    expect(madeByMatches(undefined, {})).toBe(true);
  });

  it("matches the model by its label and the author by id", () => {
    expect(madeByMatches(made, { model: "fish:2.1-pro-free", author: "u1" })).toBe(true);
    expect(madeByMatches(made, { model: "eleven:v3" })).toBe(false);
    expect(madeByMatches(made, { author: "u2" })).toBe(false);
  });

  /** A line with no take was made by nobody, so no model or author filter can admit it. */
  it("never admits a line with no take to a filter that is set", () => {
    expect(madeByMatches(undefined, { model: "eleven:v3" })).toBe(false);
  });
});
