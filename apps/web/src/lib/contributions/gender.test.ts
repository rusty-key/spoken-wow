import { describe, expect, it } from "vitest";

import { EN, type UiText } from "@/lib/ui-text/en";
import { merge } from "@/lib/site-text/merge";
import deDE from "@/lib/ui-text/deDE";
import zhCN from "@/lib/ui-text/zhCN";

import { readingWord } from "./gender";

describe("readingWord", () => {
  it("keeps the words apart in a language that spaces them", () => {
    expect(readingWord(EN, ["m", "f"])).toBe("male and female");
    expect(readingWord(merge(EN, deDE) as UiText, ["m", "f"])).toBe("männlich und weiblich");
  });

  it("writes them together in a language that does not", () => {
    expect(readingWord(merge(EN, zhCN) as UiText, ["m", "f"])).toBe("男性和女性");
  });
});
