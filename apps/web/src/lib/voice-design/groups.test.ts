import { describe, expect, it } from "vitest";

import { donenessOf, flavorOf, groupOf } from "./groups";

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
