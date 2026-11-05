import { describe, expect, it } from "vitest";

import { shownTextOf } from "./files";

describe("the text a take saves", () => {
  it("speaks a translation's tokens, because the voice said a word and not the player's name", () => {
    expect(shownTextOf("Gut gemacht, $N.", "deDE", null)).toBe("Gut gemacht, Abenteurer.");
  });

  it("takes a gendered line's own side", () => {
    expect(shownTextOf("Gut gemacht, $N.", "deDE", "f")).toBe("Gut gemacht, Abenteurerin.");
  });

  it("leaves out the pronunciation spellings, which players must not read", () => {
    expect(shownTextOf("Thrall spoke of Mulgore.", "enUS", null)).toBe("Thrall spoke of Mulgore.");
  });
});
