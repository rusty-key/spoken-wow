/**
 * Session mocked, writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { registerLanguages } from "@/lib/lang";
import { forgetLanguages } from "@/lib/languages/catalogue";
import { asSystem, systemRows, testUser } from "@/lib/teams/testing";
import { forgetTeams } from "@/lib/teams/store";

const who = vi.hoisted(() => ({ role: null as string | null, id: "" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: who.id, role: who.role } }) } },
}));

import { GET, POST } from "./route";

let admin: Awaited<ReturnType<typeof testUser>>;

const JAPANESE = { code: "jaJP", name: "Japanese", native: "日本語", bcp47: "ja-JP", provider: "ja" };

beforeAll(async () => {
  admin = await testUser("test-languages-route");
  who.id = admin.id;
});

beforeEach(() => {
  who.role = "admin";
});

afterEach(async () => {
  const teams = await systemRows<{ teamId: string }>(`select "teamId" from "team_language" where "lang" = 'jaJP'`);
  for (const { teamId } of teams) {
    for (const table of ["activity", "voice_assignment", "voice", "generation_setting", "queue_dismissal"]) {
      await asSystem.query(`delete from "${table}" where "teamId" = $1`, [teamId]);
    }
    await asSystem.query(`delete from "team_language" where "teamId" = $1`, [teamId]);
    await asSystem.query(`delete from "team_member" where "teamId" = $1`, [teamId]);
    await asSystem.query(`delete from "team" where "id" = $1`, [teamId]);
  }
  await asSystem.query(`delete from "language" where "code" = 'jaJP'`);
  forgetLanguages();
  forgetTeams();
  registerLanguages([]);
});

afterAll(async () => {
  await admin.cleanup();
  await closeDb();
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("https://example.com/api/languages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/languages", () => {
  it("adds a language, switched off, with a team to hold its work", async () => {
    const response = await post(JAPANESE);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { languages: { code: string; name: string; enabled: boolean }[] };
    expect(body.languages.find((l) => l.code === "jaJP")).toEqual({ code: "jaJP", name: "Japanese", enabled: false });
    const [row] = await systemRows<{ team: string | null }>(`select team_of_lang('jaJP') as "team"`);
    expect(row.team).not.toBeNull();
    const [lang] = await systemRows<{ client: boolean }>(`select "client" from "language" where "code" = 'jaJP'`);
    expect(lang.client).toBe(false);
    expect((await (await GET()).json()).languages.some((l: { code: string }) => l.code === "jaJP")).toBe(true);
  });

  it("refuses a language the site already has", async () => {
    expect((await post(JAPANESE)).status).toBe(200);
    expect((await post(JAPANESE)).status).toBe(409);
    expect((await post({ ...JAPANESE, code: "deDE" })).status).toBe(409);
  });

  it("refuses a malformed field", async () => {
    expect((await post({ ...JAPANESE, code: "japan" })).status).toBe(400);
    expect((await post({ ...JAPANESE, provider: "jpn" })).status).toBe(400);
    expect((await post({ ...JAPANESE, bcp47: "ja" })).status).toBe(400);
    expect((await post({ ...JAPANESE, name: "  " })).status).toBe(400);
    expect((await post({ ...JAPANESE, native: "x".repeat(61) })).status).toBe(400);
    expect((await post({ ...JAPANESE, name: 5 })).status).toBe(400);
  });

  it("is for site admins", async () => {
    who.role = null;
    expect((await post(JAPANESE)).status).toBe(403);
    const rows = await systemRows(`select 1 from "language" where "code" = 'jaJP'`);
    expect(rows).toHaveLength(0);
  });
});
