import { describe, expect, it } from "vitest";

import { checkNewLanguage, describedName } from "./validate";

describe("describedName", () => {
  it("trims a name of one line", () => {
    expect(describedName("  Stimmen Crew ")).toBe("Stimmen Crew");
    expect(describedName("日本語")).toBe("日本語");
  });

  // A team's or language's name is a line of a pack's .toc and part of its title.
  it.each(["Two\nLines", "Carriage\rReturn", "Tab\tbed", "Null\u0000", "Line Separator", "Pipe|cffff0000Red", "|"])(
    "refuses %j",
    (name) => {
      expect(describedName(name)).toBeNull();
    },
  );

  it("refuses an empty, overlong or non-text name", () => {
    expect(describedName("   ")).toBeNull();
    expect(describedName("x".repeat(61))).toBeNull();
    expect(describedName("x".repeat(60))).toBe("x".repeat(60));
    expect(describedName(42)).toBeNull();
  });

  it("says why a new language's name is refused", () => {
    expect(checkNewLanguage("xqXQ", "Xq\nOther", "Xq")).toEqual({
      error: "A new language needs an English name and a native name, each 1 to 60 characters on one line, without |.",
    });
  });
});
