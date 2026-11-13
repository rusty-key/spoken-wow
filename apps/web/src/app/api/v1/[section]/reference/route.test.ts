/**
 * The English reference read, with real tokens and only grants mocked.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Grant } from "@/lib/permissions";
import { asSystem } from "@/lib/teams/testing";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: viewer.grants }),
}));

import { createFixtures, type Fixtures } from "@/lib/text-api/testing";
import { createToken } from "@/lib/tokens/store";

import { GET } from "./route";

let f: Fixtures;
let generateToken: string;
let readNoRows: string;
let readKo: string;

const mint = async (lang: "koKR" | "qaXX", access: "none" | "read", generate: boolean) =>
  (
    await createToken({
      userId: f.user,
      lang,
      access,
      generate,
      label: "agent",
      expiresAt: new Date(Date.now() + 86_400_000),
    })
  ).token;

beforeAll(async () => {
  f = await createFixtures();
  await asSystem.query(
    `insert into "language" ("code", "enabled", "name", "native", "bcp47", "provider", "client")
     values ('qaXX', true, 'Test', 'Test', 'qa-XX', 'ja', true) on conflict do nothing`,
  );
  generateToken = await mint("koKR", "none", true);
  readKo = await mint("koKR", "read", false);
  readNoRows = await mint("qaXX", "read", false);
});

beforeEach(() => {
  viewer.grants = [
    { lang: "koKR", capability: "text" },
    { lang: "koKR", capability: "regenerate" },
    { lang: "qaXX", capability: "text" },
  ];
});

afterAll(async () => {
  await f.remove();
  await asSystem.query(`delete from "language" where "code" = 'qaXX'`);
  await closeDb();
});

const get = (token: string, query = "") =>
  GET(new Request(`https://example.com/api/v1/places/reference${query}`, { headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ section: "places" }),
  });

describe("GET /api/v1/[section]/reference", () => {
  it("gives a generate-only token the English text, with no versions", async () => {
    viewer.grants = [{ lang: "koKR", capability: "regenerate" }];
    const response = await get(generateToken, `?zone=${f.map}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { lang: string; items: Record<string, unknown>[] };
    expect(body.lang).toBe("enUS");
    expect(body.items.find((item) => item.id === f.zone)).toMatchObject({ text: "English lore." });
    for (const item of body.items) {
      expect(item).not.toHaveProperty("version");
      expect(item).not.toHaveProperty("englishText");
    }
  });

  it("gives a language with no rows of its own (a code only this file uses) the same English items", async () => {
    const body = (await (await get(readNoRows, `?zone=${f.map}`)).json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toContain(f.zone);
  });

  it("400 on ?lang=", async () => {
    expect((await get(readKo, `?zone=${f.map}&lang=deDE`)).status).toBe(400);
  });

  it("403 when the owner holds nothing", async () => {
    viewer.grants = [];
    expect((await get(readKo, `?zone=${f.map}`)).status).toBe(403);
    expect((await get(generateToken, `?zone=${f.map}`)).status).toBe(403);
  });
});
