import { match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { sectionRedirects } from "./section-routes";

/** Where Next would send `path`: the first rule whose source matches, filled in. */
function route(path: string): string | null {
  for (const rule of sectionRedirects) {
    const found = match<Record<string, string | string[]>>(rule.source, { decode: decodeURIComponent })(path);
    if (!found) continue;
    // As Next fills it in: an empty :path* takes its slash with it.
    return rule.destination.replace(/\/:(\w+)\*?/g, (_, name: string) => {
      const value = found.params[name];
      const filled = Array.isArray(value) ? value.join("/") : (value ?? "");
      return filled ? `/${filled}` : "";
    });
  }
  return null;
}

describe("the old section addresses", () => {
  it("sends the addons' Report links on", () => {
    expect(route("/zones/r/1411/razor-hill")).toBe("/places/r/1411/razor-hill");
    expect(route("/books/r/261")).toBe("/readables/r/261");
    expect(route("/deDE/books/r/n0b6c")).toBe("/deDE/readables/r/n0b6c");
  });

  it("sends the explorers and their language on", () => {
    expect(route("/zones")).toBe("/places");
    expect(route("/frFR/books")).toBe("/frFR/readables");
  });

  it("sends the contribution, sort and API pages on", () => {
    expect(route("/contributions/books")).toBe("/contributions/readables");
    expect(route("/ruRU/contributions/zones/corrections")).toBe("/ruRU/contributions/places/corrections");
    expect(route("/reports/books")).toBe("/reports/readables");
    expect(route("/reports/sort/zones")).toBe("/reports/sort/places");
    expect(route("/api/books/audio/261.mp3")).toBe("/api/readables/audio/261.mp3");
  });

  it("leaves everything else alone", () => {
    expect(route("/places/r/1411/razor-hill")).toBeNull();
    expect(route("/quests")).toBeNull();
    expect(route("/zonesx")).toBeNull();
    expect(route("/xxYY/zones")).toBeNull();
    expect(route("/api/places/audio/1411/zone.mp3")).toBeNull();
  });

  it("is permanent", () => {
    expect(sectionRedirects.every((rule) => rule.permanent)).toBe(true);
  });
});
