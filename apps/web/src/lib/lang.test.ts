import { afterEach, describe, expect, it } from "vitest";

import { LOCALES as PIPELINE_LOCALES } from "@tools/lib/locales.mjs";

import {
  allLangs,
  BASE_LANG,
  BUILTIN,
  clientLang,
  elevenLabsCode,
  isClientLang,
  isLang,
  langName,
  langTag,
  registerLanguages,
  registeredExtras,
} from "./lang";

describe("the site's language list", () => {
  // The site restates the list as a literal to get a type out of it. A code added to the
  // pipeline and not here would be a language packs could be built in and the site could not
  // show; one added here and not there, a URL prefix with nothing behind it.
  it("is the pipeline's list, in the pipeline's order", () => {
    expect(
      BUILTIN.map((locale) => ({
        code: locale.code,
        name: locale.name,
        bcp47: locale.bcp47,
        elevenLabs: locale.provider,
        client: isClientLang(locale.code),
      })),
    ).toEqual(
      PIPELINE_LOCALES.map(({ code, name, bcp47, elevenLabs, client }) => ({
        code,
        name,
        bcp47,
        elevenLabs,
        client: client !== false,
      })),
    );
  });

  it("knows Italian as a language no client runs in", () => {
    expect(isLang("itIT")).toBe(true);
    expect(isClientLang("itIT")).toBe(false);
    expect(isClientLang("ptBR")).toBe(true);
  });

  it("knows Vietnamese as a language no client runs in", () => {
    expect(isLang("viVN")).toBe(true);
    expect(isClientLang("viVN")).toBe(false);
    expect(clientLang("viVN")).toBeNull();
  });

  it("takes a contribution's language only from a client that exists", () => {
    expect(clientLang("enGB")).toBe("enUS");
    expect(clientLang("ptBR")).toBe("ptBR");
    // Nothing the game wrote says itIT: an envelope that does was made by hand.
    expect(clientLang("itIT")).toBeNull();
    expect(clientLang("xxYY")).toBeNull();
  });

  it("starts from English", () => {
    expect(BASE_LANG).toBe("enUS");
    expect(BUILTIN[0].code).toBe(BASE_LANG);
  });

  it("accepts a code only in its exact spelling", () => {
    expect(isLang("ptBR")).toBe(true);
    // A region-less or lower-cased code is a different language as far as a pack folder is
    // concerned (esES and esMX are two), so nothing normalises it into one.
    expect(isLang("pt")).toBe(false);
    expect(isLang("ptbr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });

  it("names the page's language for <html lang>", () => {
    expect(langTag("ptBR")).toBe("pt-BR");
  });
});

describe("the language registry", () => {
  afterEach(() => registerLanguages([]));

  const japanese = { code: "jaJP", name: "Japanese", native: "日本語", bcp47: "ja-JP", provider: "ja", client: false };

  it("accepts a language registered at runtime", () => {
    registerLanguages([japanese]);
    expect(isLang("jaJP")).toBe(true);
    expect(langName("jaJP")).toBe("Japanese");
    expect(langTag("jaJP")).toBe("ja-JP");
    expect(elevenLabsCode("jaJP")).toBe("ja");
    expect(isClientLang("jaJP")).toBe(false);
    expect(clientLang("jaJP")).toBeNull();
    expect(allLangs().at(-1)).toBe("jaJP");
    expect(allLangs().slice(0, BUILTIN.length)).toEqual(BUILTIN.map((l) => l.code));
  });

  it("never lets a registration overwrite a built-in", () => {
    registerLanguages([{ ...japanese, code: "deDE", name: "Wrong" }]);
    expect(langName("deDE")).toBe("German");
    expect(allLangs()).toEqual(BUILTIN.map((l) => l.code));
  });

  it("lists the registered extras without the built-ins, from the registry alone", () => {
    expect(registeredExtras()).toEqual([]);
    registerLanguages([japanese]);
    expect(registeredExtras()).toEqual([japanese]);
  });

  it("replaces the registered languages on each call", () => {
    registerLanguages([japanese]);
    registerLanguages([]);
    expect(isLang("jaJP")).toBe(false);
  });
});

describe("addresses", () => {
  it("leaves English where it always was", async () => {
    const { localeHref } = await import("./lang");
    expect(localeHref("enUS", "/quests?q=1")).toBe("/quests?q=1");
    expect(localeHref("enUS", "/")).toBe("/");
  });

  it("prefixes another language's pages, and nothing else", async () => {
    const { localeHref } = await import("./lang");
    expect(localeHref("ptBR", "/quests?q=1")).toBe("/ptBR/quests?q=1");
    expect(localeHref("ptBR", "/")).toBe("/ptBR");
    expect(localeHref("ptBR", "/api/quests/search")).toBe("/api/quests/search");
    expect(localeHref("ptBR", "https://www.wowhead.com/forever")).toBe("https://www.wowhead.com/forever");
    expect(localeHref("ptBR", "//cdn.example")).toBe("//cdn.example");
  });

  it("takes a prefix off again, and only a real language's", async () => {
    const { stripLang } = await import("./lang");
    expect(stripLang("/ptBR/quests?q=1")).toEqual({ lang: "ptBR", path: "/quests?q=1" });
    expect(stripLang("/ptBR")).toEqual({ lang: "ptBR", path: "/" });
    expect(stripLang("/ptBR?x=1")).toEqual({ lang: "ptBR", path: "/?x=1" });
    expect(stripLang("/quests")).toEqual({ lang: "enUS", path: "/quests" });
    expect(stripLang("/xxYY/quests")).toEqual({ lang: "enUS", path: "/xxYY/quests" });
  });

  it("asks an API for a language only when it is not English", async () => {
    const { withLang } = await import("./lang");
    expect(withLang("enUS", "/api/quests/search?q=1")).toBe("/api/quests/search?q=1");
    expect(withLang("ptBR", "/api/quests/search?q=1")).toBe("/api/quests/search?q=1&lang=ptBR");
    expect(withLang("ptBR", "/api/quests/audio/quests/1-accept.mp3")).toBe(
      "/api/quests/audio/quests/1-accept.mp3?lang=ptBR",
    );
  });
});
