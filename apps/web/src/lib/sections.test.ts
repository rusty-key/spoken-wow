import { describe, expect, it } from "vitest";

import { isSource } from "./sections";

describe("isSource", () => {
  it("accepts every section, bosses included", () => {
    for (const s of ["quests", "places", "readables", "bosses"]) expect(isSource(s)).toBe(true);
  });

  it("rejects the retired keys and anything that is not a string", () => {
    for (const s of ["zones", "books", "", undefined, 3]) expect(isSource(s)).toBe(false);
  });
});
