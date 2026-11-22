import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BUILTIN, LANG_SHAPE } from "@/lib/lang";

import { EN } from "./en";
import { merge } from "@/lib/site-text/merge";

/** Every string with the path reaching it. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, path ? `${path}.${key}` : key));
  }
  return [];
}

const english = new Map(leaves(EN));
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");

/** Every dictionary written, by the language code in its name. */
const written = readdirSync(__dirname)
  .map((file) => new RegExp(`^(${LANG_SHAPE})\\.ts$`).exec(file)?.[1])
  .filter((code): code is string => code !== undefined);

describe("Backstage's dictionaries", () => {
  it("writes every English key as a sentence, not an empty string", () => {
    for (const [path, text] of english) {
      expect(text.trim(), path).not.toBe("");
      expect(text, path).not.toContain("\uFFFD");
      // The site's dictionaries ban it; a translated sentence should not smuggle one in.
      expect(text, path).not.toContain("\u2014");
    }
  });

  it("has a dictionary for the languages that have one, and none invented", () => {
    expect(written.every((code) => BUILTIN.some((language) => language.code === code))).toBe(true);
  });

  for (const code of written) {
    describe(code, () => {
      it("translates every key English has, with the same placeholders", async () => {
        const mine = new Map(leaves((await import(`./${code}`)).default));
        // A backstage dictionary may cover less than English -- what it leaves out reads
        // English -- but a key it does write must be one English has, spelled the same.
        expect([...mine.keys()].filter((path) => !english.has(path))).toEqual([]);
        for (const [path, text] of mine) {
          expect(text.trim(), path).not.toBe("");
          expect(placeholders(text), path).toBe(placeholders(english.get(path)!));
          expect(text, path).not.toContain("\uFFFD");
          expect(text, path).not.toContain("\u2014");
        }
      });

      it("translates what English says, not only copies it", async () => {
        const mine = new Map(leaves((await import(`./${code}`)).default));
        const copied = [...mine].filter(([path, text]) => text.length > 40 && text === english.get(path));
        expect(copied.map(([path]) => path)).toEqual([]);
      });
    });
  }

  it("falls back to English for a language with no file at all", async () => {
    const { uiText } = await import("./index");
    expect(await uiText("enUS")).toEqual(EN);
    expect(await uiText("xxYY")).toEqual(EN);
  });

  it("reads English for a team's language, which has no dictionary and needs none", async () => {
    const { uiText } = await import("./index");
    // itIT, viVN and the like are teams' languages: not built in, registered in the `language`
    // table by whoever asked for them. Nobody has to write them a file to open Backstage in
    // one -- the page reads English, which is what a volunteer there expects anyway.
    for (const code of ["itIT", "viVN", "jaJP", "plPL"]) {
      expect(await uiText(code), code).toEqual(EN);
    }
    // Not even a language this site knows: an empty answer, never a crash.
    expect(await uiText("nonsense")).toEqual(EN);
  });

  it("lays a partial dictionary over English, so a half-done language still reads", () => {
    const over = { hub: "后台", admin: { tabs: { dashboard: "概览" } } };
    const text = merge(EN, over);
    expect(text.hub).toBe("后台");
    expect(text.admin.tabs.dashboard).toBe("概览");
    // Nought said about these: English stands in.
    expect(text.admin.tabs.release).toBe(EN.admin.tabs.release);
    expect(text.menu.signIn).toBe(EN.menu.signIn);
    // A wrong kind is no translation either.
    expect(merge(EN, { hub: 5 }).hub).toBe(EN.hub);
    expect(merge(EN, undefined)).toBe(EN);
  });

  it("answers a translated language with its own words", async () => {
    const { uiText } = await import("./index");
    const zh = await uiText("zhCN");
    expect(zh.admin.tabs.dashboard).toBe("概览");
    expect(zh.hub).toBe("后台");
    // A language a client runs in, so the interface can be read in it.
    expect(BUILTIN.some((language) => language.code === "zhCN")).toBe(true);
  });
});
