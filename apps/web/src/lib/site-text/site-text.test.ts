import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GALLERY } from "@/components/landing/shots";
import { CODES } from "@/lib/lang";

import { EN } from "./en";
import { fill } from "./format";
import { merge } from "./merge";
import { FRONT_PAGE_LANGS, NATIVE_NAMES } from "./names";

/** Every string in a dictionary with the path that reaches it, arrays by position. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, path ? `${path}.${key}` : key));
  }
  return [];
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");
const english = new Map(leaves(EN));

const written = CODES.filter((code) => code !== "enUS" && existsSync(join(__dirname, `${code}.ts`)));

describe("the front page's dictionaries", () => {
  it("fills placeholders and leaves unknown ones as written", () => {
    expect(fill("Play: {name}", { name: "Muglash" })).toBe("Play: Muglash");
    expect(fill("{a} {b}", { a: "x" })).toBe("x {b}");
  });

  it("lays a translation over English and keeps English for what it lacks", () => {
    const base = { title: "T", items: [{ a: "1" }, { a: "2" }, { a: "3" }], nested: { x: "x", y: "y" } };
    const over = { title: "Titel", items: [{ a: "eins" }], nested: { y: "why" } };
    expect(merge(base, over)).toEqual({
      title: "Titel",
      items: [{ a: "eins" }, { a: "2" }, { a: "3" }],
      nested: { x: "x", y: "why" },
    });
    expect(merge(base, { items: [{ a: "1" }, { a: "2" }, { a: "3" }, { a: "4" }] }).items).toHaveLength(3);
    expect(merge(base, { title: 5 }).title).toBe("T");
  });

  it("has one English caption per gallery shot", () => {
    expect(GALLERY).toHaveLength(EN.gallery.items.length);
  });

  it("lists as front page languages English and the ones with a dictionary, so the select offers no English page under another name", () => {
    expect([...FRONT_PAGE_LANGS].sort()).toEqual(["enUS", ...written].sort());
  });

  it("loads a dictionary for each front page language but English", () => {
    const loaders = readFileSync(join(__dirname, "index.ts"), "utf8");
    for (const code of FRONT_PAGE_LANGS.filter((lang) => lang !== "enUS")) {
      expect(loaders, code).toContain(`${code}: () => import("./${code}")`);
    }
  });

  it("names every language in itself", () => {
    expect(Object.keys(NATIVE_NAMES).sort()).toEqual([...CODES].sort());
  });

  for (const code of written) {
    describe(code, () => {
      it("has exactly the keys English has, with the same placeholders", async () => {
        const mine = new Map(leaves((await import(`./${code}.ts`)).default));
        expect([...mine.keys()].sort()).toEqual([...english.keys()].sort());
        for (const [path, text] of mine) {
          expect(text.trim(), path).not.toBe("");
          expect(placeholders(text), path).toBe(placeholders(english.get(path)!));
          expect(text, path).not.toContain("�");
          expect(text, path).not.toContain("—");
        }
      });

      it("translates what English says, not only copies it", async () => {
        const mine = new Map(leaves((await import(`./${code}.ts`)).default));
        const copied = [...mine].filter(([path, text]) => text.length > 40 && text === english.get(path));
        expect(copied.map(([path]) => path)).toEqual([]);
      });
    });
  }
});
