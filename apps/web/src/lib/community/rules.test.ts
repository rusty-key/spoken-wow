import { describe, expect, it } from "vitest";
import { compareVersions, isAllowedPackUrl, validateFields, validateNewPack } from "./rules";

const URL_OK = "https://github.com/someone/their-pack/releases/download/v1.0.0/Pack.zip";

function input(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "elune-quests-de",
    title: "Elune Quests",
    author: "Elune",
    description: "Quests read by a team of friends.",
    lang: "deDE",
    section: "quests",
    version: "1.0.0",
    size: 1234,
    sha256: "ab".repeat(32),
    url: URL_OK,
    homepage: "https://example.com/elune",
    license: "CC-BY-4.0",
    ...extra,
  };
}

describe("validateNewPack", () => {
  it("accepts a good entry and lower-cases the checksum", () => {
    const res = validateNewPack(input({ sha256: "AB".repeat(32) }));
    expect(res).toMatchObject({
      ok: true,
      value: { id: "elune-quests-de", sha256: "ab".repeat(32), size: 1234, lang: "deDE", section: "quests" },
    });
  });

  it("accepts a size given as a numeric string", () => {
    expect(validateNewPack(input({ size: "734003200" }))).toMatchObject({ ok: true, value: { size: 734003200 } });
  });

  it("trims strings and turns an empty homepage or license into null", () => {
    const res = validateNewPack(input({ title: "  Elune Quests  ", homepage: "  ", license: "" }));
    expect(res).toMatchObject({ ok: true, value: { title: "Elune Quests", homepage: null, license: null } });
  });

  it("accepts an entry without homepage and license, and an objects.githubusercontent.com url", () => {
    const { homepage: _h, license: _l, ...rest } = input();
    const res = validateNewPack({
      ...rest,
      url: "https://objects.githubusercontent.com/github-production-release-asset/1/2",
    });
    expect(res).toMatchObject({ ok: true, value: { homepage: null, license: null } });
  });

  it("accepts any language code of the form xxYY", () => {
    expect(validateNewPack(input({ lang: "heIL" }))).toMatchObject({ ok: true });
  });

  const bad: [string, string, Record<string, unknown>][] = [
    ["an id with capitals", "id", { id: "Elune" }],
    ["an id with an underscore", "id", { id: "a_b" }],
    ["an id with a leading hyphen", "id", { id: "-a" }],
    ["an id with a double hyphen", "id", { id: "a--b" }],
    ["an id with a slash", "id", { id: "../x" }],
    ["an empty id", "id", { id: "" }],
    ["an id over 48 characters", "id", { id: "a".repeat(49) }],
    ["a numeric id", "id", { id: 5 }],
    ["a language that is no code", "lang", { lang: "hebrew" }],
    ["a language in the wrong case", "lang", { lang: "dede" }],
    ["an unknown section", "section", { section: "music" }],
    ["a legacy section name", "section", { section: "zones" }],
    ["no title", "title", { title: "" }],
    ["a blank title", "title", { title: "   " }],
    ["a title over 80 characters", "title", { title: "x".repeat(81) }],
    ["a control character in the author", "author", { author: "a\u0000b" }],
    ["an over-long description", "description", { description: "x".repeat(401) }],
    ["a version that is not a version", "version", { version: "latest" }],
    ["a version with a space", "version", { version: "1.0 beta" }],
    ["a numeric version", "version", { version: 1 }],
    ["a zero size", "size", { size: 0 }],
    ["a negative size", "size", { size: -5 }],
    ["a fractional size", "size", { size: 1.5 }],
    ["a size that is text but no number", "size", { size: "big" }],
    ["a size over the limit", "size", { size: 9 * 1024 ** 3 }],
    ["a short sha256", "sha256", { sha256: "ab".repeat(31) }],
    ["a non-hex sha256", "sha256", { sha256: "zz".repeat(32) }],
    ["a missing sha256", "sha256", { sha256: undefined }],
    ["an http url", "url", { url: URL_OK.replace("https", "http") }],
    ["a url on another host", "url", { url: "https://evil.example/someone/pack/releases/download/v1/p.zip" }],
    ["a github url that is not a release asset", "url", { url: "https://github.com/someone/pack/archive/main.zip" }],
    ["a github url with a query", "url", { url: `${URL_OK}?x=1` }],
    ["a url with credentials", "url", { url: "https://user:pw@github.com/a/b/releases/download/v1/p.zip" }],
    ["a url with a port", "url", { url: "https://github.com:8443/a/b/releases/download/v1/p.zip" }],
    ["an http homepage", "homepage", { homepage: "http://example.com" }],
    ["a javascript homepage", "homepage", { homepage: "javascript:alert(1)" }],
    ["a homepage that is not a url", "homepage", { homepage: "my page" }],
    ["a license over 60 characters", "license", { license: "x".repeat(61) }],
  ];
  for (const [name, field, patch] of bad) {
    it(`refuses ${name}`, () => {
      const res = validateNewPack(input(patch));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(typeof res.errors[field]).toBe("string");
    });
  }

  it("reports every bad field at once", () => {
    const res = validateNewPack(input({ id: "A", title: "" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.errors).sort()).toEqual(["id", "title"]);
  });

  it("refuses things that are not objects", () => {
    for (const v of [null, 5, "x", [], undefined]) expect(validateNewPack(v).ok).toBe(false);
  });
});

describe("validateFields", () => {
  it("does not ask for id, lang or section", () => {
    const { id: _i, lang: _l, section: _s, ...rest } = input();
    expect(validateFields(rest)).toMatchObject({ ok: true, value: { title: "Elune Quests" } });
  });
});

describe("compareVersions", () => {
  it("orders numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });
  it("ranks a pre-release below its release", () => {
    expect(compareVersions("1.1.0-beta.1", "1.1.0")).toBeLessThan(0);
  });
  it("is null for something that is no version", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
  });
});

describe("isAllowedPackUrl", () => {
  it("allows a GitHub release asset", () => {
    expect(isAllowedPackUrl(URL_OK)).toBe(true);
    expect(isAllowedPackUrl("https://github.com/a/b/releases/download/v1/a%20b.zip")).toBe(true);
  });
  it("refuses a query, http, or another host", () => {
    expect(isAllowedPackUrl(`${URL_OK}?x=1`)).toBe(false);
    expect(isAllowedPackUrl(URL_OK.replace("https", "http"))).toBe(false);
    expect(isAllowedPackUrl("https://github.com.evil.example/a/b/releases/download/v1/p.zip")).toBe(false);
    expect(isAllowedPackUrl("https://github.com/a/b/releases/latest/download/p.zip")).toBe(false);
    expect(isAllowedPackUrl("https://github.com/a/b/releases/download/v1/x/y.zip")).toBe(false);
  });
});
