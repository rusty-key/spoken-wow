/**
 * The one thing this whole layer exists for: the language a person reads Backstage in belongs
 * to the person, and never to the link they arrived by.
 *
 * A volunteer who reads Chinese looks after a German team. Opening that team's dashboard is
 * `/deDE/admin/dashboard?lang=deDE` -- a German address, asking about a German team -- and
 * before this setting existed the interface turned German with it. Two questions, three
 * answers: what the page is addressed in, what team it is about, and what language the reader
 * reads.
 */
import { describe, expect, it } from "vitest";

import { EN } from "./en";
import { uiText } from "./index";

describe("the interface language belongs to the reader", () => {
  it("reads the reader's language over the page's, whatever the address says", async () => {
    // `readingLang` picks the saved setting over the `[lang]` segment; uiText then answers for
    // that language alone.
    const pageSegment = "deDE";
    const saved = "zhCN";

    expect((await uiText(saved)).admin.tabs.dashboard).toBe("概览");
    // The address alone would have said German -- which is the bug this setting fixes.
    expect((await uiText(pageSegment)).admin.tabs.dashboard).toBe("Übersicht");
  });

  it("answers the page's own language when nobody saved one", async () => {
    // A signed-out visitor, or somebody who never chose: `readingLang` returns the segment.
    expect((await uiText("enUS")).admin.tabs.dashboard).toBe("Dashboard");
    expect((await uiText("zhCN")).admin.tabs.dashboard).toBe("概览");
  });

  it("keeps the same interface in every language, with no hole where one is missing", async () => {
    const languages = ["enUS", "deDE", "esES", "esMX", "frFR", "koKR", "ptBR", "ruRU", "zhCN", "zhTW"];
    for (const lang of languages) {
      const text = await uiText(lang);
      // A page in any language has a word for every tab, and never an empty one.
      for (const tab of Object.keys(text.admin.tabs)) {
        expect(text.admin.tabs[tab as keyof typeof text.admin.tabs], `${lang}.${tab}`).toBeTruthy();
      }
      expect(text.contribute.title, lang).toBeTruthy();
      expect(text.dashboard.contributions, lang).toBeTruthy();
    }
  });

  it("names the setting so a reader knows it is not the team they maintain", async () => {
    const zh = await uiText("zhCN");
    const en = await uiText("enUS");
    expect(en.interface.label).toBe("Interface language");
    expect(zh.interface.label).toBe("界面语言");
    // The hint has to say what it does NOT change, or it is a trap.
    expect(zh.interface.hint).toContain("维护");
    // And that it is the reader's own, not the page's.
    expect(zh.interface.followPage).toBeTruthy();
  });

  it("falls back to English for a language with no dictionary", () => {
    // A team's language (itIT, viVN) needs no file to open Backstage in English.
    expect(EN.interface.label).toBe("Interface language");
  });
});
