import { describe, expect, it } from "vitest";

import { safeNext } from "./AuthForm";

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    for (const next of ["/", "/admin", "/ptBR/quests?q=1#top", "/a\\b"]) expect(safeNext(next)).toBe(next);
  });

  it("falls back to / for anything a browser could read as another origin", () => {
    for (const next of [null, undefined, "", "admin", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/ /evil.com", "https://evil.com", "\\/evil.com"]) {
      expect(safeNext(next)).toBe("/");
    }
  });
});
