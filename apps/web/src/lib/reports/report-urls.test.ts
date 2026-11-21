/**
 * The report addresses the addon builds, against the pages that answer them.
 *
 * tests/fixtures/report-urls.txt is written by tests/lua/report_url_contract_test.lua from the
 * modules' own code, one address per shape and section. Each must reach a /r/ page in one hop:
 * the language rewrite (lib/locale-routes.ts), then a page under src/app/[lang]/ whose own parser
 * takes the rest. A zone report that lost its language, or an object report the page could not
 * parse, fails here before a player finds it.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { BASE_LANG, isLang } from "@/lib/lang";
import { localeRedirects, localeRewrites } from "@/lib/locale-routes";
import { pageSections } from "@/lib/page-sections";

import { parseTarget } from "./target";

const SITE = "https://spoken.quest";

const urls = readFileSync(
  new URL("../../../../../tests/fixtures/report-urls.txt", import.meta.url),
  "utf8",
)
  .split(/\r?\n/)
  .filter(Boolean);

/** Where Next would send `path`: the first rule whose source matches, filled in. */
function route(rules: { source: string; destination: string }[], path: string): string | null {
  for (const rule of rules) {
    const found = match<Record<string, string | string[]>>(rule.source, { decode: decodeURIComponent })(path);
    if (!found) continue;
    return rule.destination.replace(/\/:(\w+)\*?/g, (_, name: string) => {
      const value = found.params[name];
      const filled = Array.isArray(value) ? value.join("/") : (value ?? "");
      return filled ? `/${filled}` : "";
    });
  }
  return null;
}

/** The page file under src/app that serves a section's report address. */
const PAGES = {
  quests: "[lang]/quests/r/[...target]/page.tsx",
  places: "[lang]/places/r/[mapID]/[slug]/page.tsx",
  readables: "[lang]/readables/r/[pageId]/page.tsx",
  bosses: "[lang]/bosses/r/[map]/[slug]/page.tsx",
} as const;

type Section = keyof typeof PAGES;

/** What a section's page takes after /r/, or null for an address it would not open. */
function kindOf(section: Section, rest: string): string | null {
  if (section === "quests") return parseTarget(rest.split("/"))?.kind ?? null;
  if (section === "places" || section === "bosses") return /^\d+\/[a-z0-9-]+$/.test(rest) ? section : null;
  return /^\d+$/.test(rest) ? "readables" : null;
}

describe("the report addresses the addon builds", () => {
  it("are on the site", () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(new URL(url).origin, url).toBe(SITE);
  });

  it("reach their page in one hop, in the language they were filed under", () => {
    const kinds = new Set<string>();
    const languages = new Set<string>();
    for (const url of urls) {
      const path = new URL(url).pathname;
      // English goes bare; an /enUS/ prefix would be redirected first.
      expect(route(localeRedirects, path), url).toBeNull();
      const served = route(localeRewrites(pageSections()), path) ?? path;
      const parts = served.match(/^\/([^/]+)\/(quests|places|readables|bosses)\/r\/(.+)$/);
      expect(parts, url).not.toBeNull();
      const [, lang, section, rest] = parts!;
      expect(isLang(lang), url).toBe(true);
      const page = fileURLToPath(new URL(`../../app/${PAGES[section as Section]}`, import.meta.url));
      expect(existsSync(page), page).toBe(true);
      const kind = kindOf(section as Section, rest);
      expect(kind, url).not.toBeNull();
      kinds.add(kind!);
      languages.add(lang);
    }
    // Every shape the addon sends is in the fixture, so the file cannot quietly lose one.
    expect([...kinds].sort()).toEqual(["bosses", "npc", "object", "places", "quest", "readables"]);
    expect(languages.has(BASE_LANG) && languages.size > 1).toBe(true);
  });
});
