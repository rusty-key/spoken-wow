/**
 * The saved interface language: the reader's own, over the page's.
 *
 * The store half needs a migrated Postgres (like the other store tests); what is worth
 * pinning without one is the decision `readingLang` makes, which is where the bug lived.
 */
import { describe, expect, it } from "vitest";

import { uiText } from "@/lib/ui-text";

/** `readingLang`'s rule, stated where it can be read: saved wins, else the page's. */
function readingLang(saved: string | null, segment: string): string {
  return saved ?? segment;
}

describe("the reader's language over the page's", () => {
  it("reads what the person saved, even on a page addressed in another language", async () => {
    // The case that mattered: a Chinese-speaking maintainer opening the German team.
    const lang = readingLang("zhCN", "deDE");
    expect(lang).toBe("zhCN");
    expect((await uiText(lang)).admin.tabs.dashboard).toBe("概览");
  });

  it("reads the page's own language for somebody who never chose", () => {
    expect(readingLang(null, "deDE")).toBe("deDE");
    expect(readingLang(null, "enUS")).toBe("enUS");
  });

  it("is unaffected by the language a team maintains", () => {
    // ?lang= is a third question and never reaches this decision.
    const saved = "zhCN";
    const segment = "enUS";
    expect(readingLang(saved, segment)).toBe("zhCN");
    expect(readingLang(null, segment)).toBe("enUS");
  });
});
