/**
 * The one thing this whole layer exists for: an admin page's `?lang=` is the language a team
 * maintains, and never the language the page is read in. `/zhCN/admin/dashboard?lang=deDE` is
 * a Chinese interface over the German team, and reading the German team must not turn the
 * interface German.
 */
import { describe, expect, it } from "vitest";

import { uiText } from "./index";

describe("the interface language is the [lang] segment, not ?lang=", () => {
  it("reads Chinese while the language administered is German", async () => {
    // The layout asks uiText for the page's own language; the page separately reads `?lang=`
    // for the team. Two different questions, two different answers.
    const pageLang = "zhCN";
    const teamLang = "deDE";

    const text = await uiText(pageLang);
    expect(text.admin.tabs.dashboard).toBe("概览");

    // Nothing in the dictionary is keyed by the administered language: asking for the page's
    // language is the only input, so the team's code cannot leak into the interface.
    const german = await uiText(teamLang);
    expect(german.admin.tabs.dashboard).toBe("Übersicht");
    expect(german).not.toBe(text);
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

  it("names the interface setting so a reader knows it is not the team", async () => {
    const zh = await uiText("zhCN");
    const en = await uiText("enUS");
    expect(en.interface.label).toBe("Interface language");
    expect(zh.interface.label).toBe("界面语言");
    // The hint has to say what it does NOT change, or it is a trap.
    expect(zh.interface.hint).toContain("维护");
  });
});
