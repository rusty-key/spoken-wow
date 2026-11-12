import { match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { localeRedirects, localeRewrites } from "./locale-routes";
import { pageSections } from "./page-sections";

/** Next's matching: case-insensitive, whatever caseSensitiveRoutes says for before-files rewrites. */
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

const rewrites = localeRewrites(["quests", "npcs", "places", "admin"]);

describe("the language in the URL", () => {
  it("serves a bare path as English, without changing the address", () => {
    expect(route(rewrites, "/quests")).toBe("/enUS/quests");
    expect(route(rewrites, "/quests/lines/42")).toBe("/enUS/quests/lines/42");
    expect(route(rewrites, "/npcs")).toBe("/enUS/npcs");
    expect(route(rewrites, "/npcs/1")).toBe("/enUS/npcs/1");
    expect(route(localeRedirects, "/quests")).toBeNull();
  });

  it("serves the landing page as English", () => {
    expect(route(rewrites, "/")).toBe("/enUS");
  });

  it("sends an explicit English prefix back to the one address English has", () => {
    expect(route(localeRedirects, "/enUS/quests")).toBe("/quests");
    expect(route(localeRedirects, "/enus/quests")).toBe("/quests");
    expect(route(localeRedirects, "/enUS")).toBe("/");
    expect(localeRedirects.every((rule) => rule.permanent)).toBe(true);
  });

  it("passes any language through as it is, known or not", () => {
    for (const path of ["/ptBR/quests", "/ptBR", "/jaJP/quests", "/xxYY/quests"]) {
      expect(route(rewrites, path), path).toBeNull();
    }
    expect(route(localeRedirects, "/jaJP/quests")).toBeNull();
  });

  it("stays away from the API, Next's assets, downloads and files", () => {
    for (const path of ["/api/x", "/_next/static/chunk.js", "/downloads/a.zip", "/logo.png", "/icons/quests.png", "/apis"]) {
      expect(route(rewrites, path), path).toBeNull();
    }
  });

  it("knows the real pages", () => {
    expect(pageSections()).toEqual(expect.arrayContaining(["quests", "npcs", "places", "admin"]));
    expect(pageSections()).not.toContain("[lang]");
  });
});
