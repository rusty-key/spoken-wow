import { describe, expect, it } from "vitest";

import { donenessOf, flavorOf, groupOf, playersSay } from "./groups";

describe("groupOf", () => {
  it.each([
    ["orc-male-shady", "orc-male", "shady"],
    ["bloodelf-female", "bloodelf-female", null],
    ["troll-male-witch-doctor", "troll-male", "witch-doctor"],
  ])("%s", (slot, group, flavor) => {
    expect(groupOf(slot)).toBe(group);
    expect(flavorOf(slot)).toBe(flavor);
  });
});

describe("donenessOf", () => {
  it("is none without a design, pending without a verdict, else the newest verdict", () => {
    expect(donenessOf(null)).toBe("none");
    expect(donenessOf({ reviews: [] })).toBe("pending");
    expect(donenessOf({ reviews: [{ status: "needs-work" }, { status: "good" }] })).toBe("good");
    expect(donenessOf({ reviews: [{ status: "good" }, { status: "needs-work" }] })).toBe("needs-work");
  });
});

describe("playersSay", () => {
  const shown = (fits: number, close: number, off: number, skip = 0) => ({
    isPublic: true,
    showings: [{ counts: { fits, close, off, skip } }, { counts: { fits: 0, close: 0, off: 99, skip: 0 } }],
  });

  it("reads the round players are voting in now, skips aside", () => {
    expect(playersSay([shown(3, 1, 1, 9)])).toBe("fits");
    expect(playersSay([shown(1, 1, 3)])).toBe("off");
    expect(playersSay([shown(2, 1, 2)])).toBe("mixed");
    expect(playersSay([shown(0, 3, 1)])).toBe("mixed");
    expect(playersSay([shown(0, 0, 0, 4)])).toBe("no-votes");
  });

  it("has nothing to say about a slot players do not hear", () => {
    expect(playersSay([])).toBeNull();
    expect(playersSay([{ isPublic: false, showings: [{ counts: { fits: 5, close: 0, off: 0, skip: 0 } }] }])).toBeNull();
  });
});
