/**
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: [{ lang: "koKR", capability: "text" }] }),
}));

import { createToken } from "@/lib/tokens/store";

import { GET } from "./route";

const USER = `test-describe-${Math.random().toString(36).slice(2, 10)}`;
let token: string;

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test', $1 || '@example.invalid', false)`,
    [USER],
  );
  ({ token } = await createToken({
    userId: USER,
    lang: "koKR",
    access: "read",
    generate: false,
    label: "agent",
    expiresAt: new Date(Date.now() + 86_400_000),
  }));
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

const get = (auth?: string) =>
  GET(new Request("https://example.com/api/v1", auth ? { headers: { authorization: `Bearer ${auth}` } } : {}));

describe("GET /api/v1", () => {
  it("401 with no token", async () => {
    expect((await get()).status).toBe(401);
  });

  it("states the token's language and access, and every section with its filters", async () => {
    expect(await (await get(token)).json()).toMatchObject({
      token: { lang: "koKR", access: "read" },
      sections: {
        places: { filters: ["zone"] },
        bosses: { filters: ["instance"] },
        readables: { filters: ["book"] },
        quests: { filters: ["quest", "source", "minLevel", "maxLevel"] },
      },
    });
  });

  it("lists the reference and generate endpoints and the token's generate flag", async () => {
    const body = (await (await get(token)).json()) as { token: unknown; endpoints: Record<string, string> };
    expect(body.token).toMatchObject({ generate: false });
    expect(Object.keys(body.endpoints)).toEqual(
      expect.arrayContaining(["GET /api/v1/{section}/reference", "POST /api/v1/{section}/generate"]),
    );
  });

  it("states the limits", async () => {
    expect(await (await get(token)).json()).toMatchObject({
      limits: { pageSize: 500, itemsPerUpdate: 1000, textLength: 5000, nameLength: 200, itemsPerGeneration: 1000, requestBytes: 8_388_608 },
    });
  });

  it("points at documents a client can open", async () => {
    const { docs } = (await (await get(token)).json()) as { docs: string };
    expect(docs).toMatch(/^https:\/\//);
  });
});
