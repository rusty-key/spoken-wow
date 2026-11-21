import { describe, expect, it } from "vitest";

import { NO_TEXT, shownText } from "./shown";

describe("shownText", () => {
  it("says a page has no words in this language when nothing stands in", () => {
    expect(shownText({ text: "", missing: { text: true } })).toBe(NO_TEXT);
    expect(NO_TEXT).toBe("<no text>");
  });

  it("keeps the words that stand in, and the page's own", () => {
    expect(shownText({ text: "English words.", missing: { text: true } })).toBe("English words.");
    expect(shownText({ text: "Palabras." })).toBe("Palabras.");
  });
});
