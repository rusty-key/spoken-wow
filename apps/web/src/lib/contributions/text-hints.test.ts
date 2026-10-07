import { describe, expect, it } from "vitest";

import { textHints } from "./text-hints";

describe("textHints", () => {
  it("is empty for a line the gate voices", () => {
    expect(textHints("Seid gegrüßt, $uReisender:Reisende;. Die Legion $Ns wartet.", "deDE")).toEqual([]);
    expect(textHints("Thanks, $N.", "enGB")).toEqual([]);
  });

  it("names a token the gate cannot speak", () => {
    // q:98362:accept, its `g` lost, and q:97963:accept, its `;` lost.
    expect(textHints("Ihr seid $einen würdigen Schüler:eine würdige Schülerin;.", "deDE")).toEqual([
      "unspoken token $einen — won't be voiced",
    ]);
    expect(textHints("Ein $gAlchimist:Alchimistin in der Stadt", "deDE")).toEqual([
      "unspoken token $gAlchimist:Alchimistin — won't be voiced",
    ]);
  });

  it("flags the gap a gender branch resolved to nothing leaves", () => {
    // q:92703:complete.
    expect(textHints("…danken kann, . Ich habe  gefunden.", "deDE")).toEqual([
      "gap before punctuation — a gender branch may be missing",
    ]);
    expect(textHints("Vraiment ? Allez !", "frFR")).toEqual([]);
  });
});
