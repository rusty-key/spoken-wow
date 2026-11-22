import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
const saved = vi.hoisted(() => new Map<string, string>());

vi.mock("@/lib/session", () => ({ currentSession: async () => session.current }));
vi.mock("@/lib/users/ui-language", () => ({ uiLangOf: async (id: string) => saved.get(id) ?? null }));

import { readingLang } from "./lang-server";

beforeEach(() => {
  session.current = null;
  saved.clear();
});

describe("readingLang", () => {
  it("reads the reader's saved language over the page's", async () => {
    session.current = { user: { id: "u1" } };
    saved.set("u1", "zhCN");
    expect(await readingLang("deDE")).toBe("zhCN");
  });

  it("reads the page's language for a reader who never chose", async () => {
    session.current = { user: { id: "u1" } };
    expect(await readingLang("deDE")).toBe("deDE");
  });

  it("reads the page's language for a signed-out visitor", async () => {
    saved.set("u1", "zhCN");
    expect(await readingLang("deDE")).toBe("deDE");
  });
});

describe("the front page", () => {
  // A signed-in reader who saved Chinese must still get German at /deDE. A layout cannot tell
  // which page it wraps, so the setting is reachable only from the Backstage layout.
  const app = path.join(__dirname, "..", "app", "[lang]");
  it.each(["page.tsx", "layout.tsx"])("never reads the reader's setting in %s", (file) => {
    const source = readFileSync(path.join(app, file), "utf8");
    expect(source).not.toMatch(/readingLang|@\/lib\/ui-text|UiTextProvider|ui-language/);
  });
});
