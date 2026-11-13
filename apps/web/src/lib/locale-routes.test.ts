import { match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { localeRedirects, localeRewrites } from "./locale-routes";

/** Where Next would send `path`: the first rule whose source matches, filled in. */
function route(rules: { source: string; destination: string }[], path: string): string | null {
  for (const rule of rules) {
    const found = match<Record<string, string | string[]>>(rule.source, { decode: decodeURIComponent })(path);
    if (!found) continue;
    return rule.destination.replace(/:(\w+)\*?/g, (_, name: string) => {
      const value = found.params[name];
      return Array.isArray(value) ? value.join("/") : (value ?? "");
    });
  }
  return null;
}

describe("the language in the URL", () => {
  it("serves a bare path as English, without changing the address", () => {
    expect(route(localeRewrites, "/quests")).toBe("/enUS/quests");
    expect(route(localeRewrites, "/quests/lines/42")).toBe("/enUS/quests/lines/42");
    expect(route(localeRedirects, "/quests")).toBeNull();
  });

  it("serves the landing page as English", () => {
    expect(route(localeRewrites, "/")).toBe("/enUS");
  });

  it("sends an explicit English prefix back to the one address English has", () => {
    expect(route(localeRedirects, "/enUS/quests")).toBe("/quests");
    expect(route(localeRedirects, "/enUS")).toBe("/");
    expect(localeRedirects.every((rule) => rule.permanent)).toBe(true);
  });

  it("passes another language through as it is", () => {
    expect(route(localeRewrites, "/ptBR/quests")).toBeNull();
    expect(route(localeRewrites, "/ptBR")).toBeNull();
    expect(route(localeRedirects, "/ptBR/quests")).toBeNull();
  });

  it("does not take something shaped like a language for one", () => {
    expect(route(localeRewrites, "/xxYY/quests")).toBe("/enUS/xxYY/quests");
  });

  it("stays away from the API, Next's assets, downloads and files", () => {
    for (const path of [
      "/api/quests/search",
      "/_next/static/chunk.js",
      "/downloads/SpokenQuestsAudioComplete-latest.zip",
      "/logo.png",
      "/icons/quests.png",
    ]) {
      expect(route(localeRewrites, path), path).toBeNull();
    }
    // A page whose name merely starts like one of those is still a page.
    expect(route(localeRewrites, "/apis")).toBe("/enUS/apis");
  });
});
