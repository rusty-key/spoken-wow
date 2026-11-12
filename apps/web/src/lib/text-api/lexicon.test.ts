import { describe, expect, it } from "vitest";

import { LexiconError, type LexiconEntry } from "@/lib/generation/lexicon";

import { findEntry, upsertEntries, validateItems } from "./lexicon";

const A: LexiconEntry = { grapheme: "Gnomeregan", ipa: "ˈnoʊmɹəɡæn", confidence: "high" };
const B: LexiconEntry = { grapheme: "Thrall", alias: "thrawl", confidence: "check" };

describe("upsertEntries", () => {
  it("replaces in place, appends new ones, and says which", () => {
    const changed = { ...A, ipa: "ˈnoʊməɹɡæn" };
    const added: LexiconEntry = { grapheme: "Mulgore", alias: "MULL-gore", confidence: "high" };
    const { entries, result } = upsertEntries([A, B], [changed, B, added]);

    expect(entries).toEqual([changed, B, added]);
    expect(result.map((r) => r.status)).toEqual(["updated", "unchanged", "created"]);
  });

  it("matches ignoring case and keeps the spelling sent", () => {
    const { entries, result } = upsertEntries([A], [{ ...A, grapheme: "gnomeregan" }]);
    expect(entries).toEqual([{ ...A, grapheme: "gnomeregan" }]);
    expect(result[0].status).toBe("updated");
  });

  it("replaces an entry whole, dropping a note left out", () => {
    const { entries } = upsertEntries([{ ...A, note: "from the cinematic" }], [A]);
    expect(entries).toEqual([A]);
  });
});

describe("validateItems", () => {
  it("refuses the same grapheme twice, ignoring case", () => {
    expect(() => validateItems([A, { ...A, grapheme: "GNOMEREGAN" }])).toThrow(LexiconError);
  });

  it("names the bad item", () => {
    expect(() => validateItems([A, { grapheme: "Thrall", confidence: "high" }])).toThrow(/entry 1/);
  });
});

describe("findEntry", () => {
  it("ignores case", () => {
    expect(findEntry([A, B], "THRALL")).toBe(B);
    expect(findEntry([A, B], "Orgrimmar")).toBeUndefined();
  });
});
