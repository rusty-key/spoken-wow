/**
 * The read routes with real tokens and only grants mocked, so the guard and the adapters are
 * what answers.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: [{ lang: "koKR", capability: "text" }] }),
}));

import { createFixtures, LANG, type Fixtures } from "@/lib/text-api/testing";
import { createToken } from "@/lib/tokens/store";

import { GET as one } from "./[id]/route";
import { GET as list } from "./route";

let f: Fixtures;
let token: string;

beforeAll(async () => {
  f = await createFixtures();
  ({ token } = await createToken({
    userId: f.user,
    lang: LANG,
    access: "read",
    generate: false,
    label: "agent",
    expiresAt: new Date(Date.now() + 86_400_000),
  }));
});

afterAll(async () => {
  await f.remove();
  await closeDb();
});

function request(path: string, auth: string | null = token): Request {
  return new Request(`https://example.com/api/v1/${path}`, {
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
  });
}

const listOf = (section: string, query = "", auth?: string | null) =>
  list(request(`${section}${query}`, auth), { params: Promise.resolve({ section }) });

const oneOf = (section: string, id: string, query = "", auth?: string | null) =>
  one(request(`${section}/${id}${query}`, auth), { params: Promise.resolve({ section, id }) });

describe("GET /api/v1/[section]", () => {
  it("404 on an unknown section", async () => {
    expect((await listOf("zones")).status).toBe(404);
  });

  it("401 with no token", async () => {
    expect((await listOf("places", "", null)).status).toBe(401);
  });

  it("lists the token's language, whatever ?lang= says", async () => {
    const response = await listOf("places", `?zone=${f.map}&lang=frFR`).catch(() => null);
    expect(response?.status).toBe(400);
    const body = (await (await listOf("places", `?zone=${f.map}`)).json()) as { items: unknown[]; lang: string };
    expect(body.lang).toBe(LANG);
    expect(body.items).toHaveLength(2);
  });

  it.each([
    ["an unknown parameter", "places", "?zones=1"],
    ["another section's filter", "bosses", "?zone=1"],
    ["a bad filter value", "places", "?zone=abc"],
    ["a bad source", "quests", "?source=everything"],
    ["a malformed cursor", "places", "?cursor=notbase64json"],
    ["a cursor of the wrong shape", "quests", `?cursor=${Buffer.from('"x"').toString("base64url")}`],
    ["a limit over 500", "places", "?limit=501"],
    ["a limit of zero", "places", "?limit=0"],
  ])("400 on %s", async (_name, section, query) => {
    expect((await listOf(section, query)).status).toBe(400);
  });

  it("follows a cursor", async () => {
    const first = (await (await listOf("places", `?zone=${f.map}&limit=1`)).json()) as {
      items: { id: string }[];
      nextCursor: string;
    };
    expect(first.items).toHaveLength(1);
    const second = (await (await listOf("places", `?zone=${f.map}&limit=1&cursor=${first.nextCursor}`)).json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.nextCursor).toBeNull();
  });

  it("returns exactly the item's fields, no audio or hash", async () => {
    const body = (await (await listOf("bosses", `?instance=${f.map}`)).json()) as { items: Record<string, unknown>[] };
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ["englishName", "englishText", "group", "id", "name", "nameVersion", "text", "version"].sort(),
    );
  });
});

describe("GET /api/v1/[section]/[id]", () => {
  it("401 with no token", async () => {
    expect((await oneOf("places", f.zone, "", null)).status).toBe(401);
  });

  it("finds an id whether or not its colons arrive encoded", async () => {
    expect((await oneOf("places", f.subzone)).status).toBe(200);
    expect((await oneOf("places", encodeURIComponent(f.subzone))).status).toBe(200);
  });

  it("reads ?variant= for quests", async () => {
    const body = (await (await oneOf("quests", f.quest.lineId, `?variant=${f.quest.variant}`)).json()) as {
      variant: number;
    };
    expect(body.variant).toBe(f.quest.variant);
  });

  it("400 on ?variant= elsewhere", async () => {
    expect((await oneOf("places", f.zone, "?variant=1")).status).toBe(400);
  });

  it("400 on a bad ?variant=", async () => {
    expect((await oneOf("quests", f.quest.lineId, "?variant=x")).status).toBe(400);
  });

  it("400 on a ?variant= too big to store", async () => {
    expect((await oneOf("quests", f.quest.lineId, "?variant=99999")).status).toBe(400);
  });

  it("400 on a ?quest= too big to store", async () => {
    expect((await listOf("quests", "?quest=99999999999")).status).toBe(400);
  });

  it("400 on a cursor too big to store", async () => {
    const cursor = Buffer.from(JSON.stringify(["q:1", 40000])).toString("base64url");
    expect((await listOf("quests", `?cursor=${cursor}`)).status).toBe(400);
  });

  it("404 on a NUL in an id", async () => {
    expect((await oneOf("quests", "q%3A1%00")).status).toBe(404);
  });

  it("404 on an unknown id", async () => {
    expect((await oneOf("places", "z:nothing")).status).toBe(404);
  });

  it("404 on an unknown section", async () => {
    expect((await oneOf("zones", f.zone)).status).toBe(404);
  });
});
