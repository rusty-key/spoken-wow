/**
 * Session and grants mocked, writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import type { Viewer } from "@/lib/permissions";
import { asSystem, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ viewer: { role: null, grants: [] } as Viewer, id: "" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: who.id, role: who.viewer.role } }) } },
}));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => who.viewer,
}));

import { grantsOf } from "@/lib/grants/store";

import { DELETE, PUT } from "./route";

let target: Awaited<ReturnType<typeof testUser>>;
let granter: Awaited<ReturnType<typeof testUser>>;
const email = () => `${target.id}@example.invalid`;

beforeAll(async () => {
  target = await testUser("test-grants-route");
  granter = await testUser("test-grants-route-by");
  who.id = granter.id;
  await asSystem.query(
    `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled", "textByTeam")
     values ('xqGR', 'Xq', 'Xq', 'xq-GR', 'xq', false, false, true) on conflict do nothing`,
  );
  forgetLanguages();
  await loadLanguages();
});

beforeEach(() => {
  who.viewer = { role: null, grants: [{ lang: "deDE", capability: "admin" }] };
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1`, [target.id]);
  await asSystem.query(`delete from "language_grant" where "userId" = $1`, [target.id]);
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [target.id]);
  await asSystem.query(`delete from "language" where "code" = 'xqGR'`);
  forgetLanguages();
  await target.cleanup();
  await granter.cleanup();
  await closeDb();
});

function put(capabilities: string[], lang = "deDE"): Promise<Response> {
  return PUT(
    new Request("https://example.com/api/grants", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email(), lang, capabilities }),
    }),
  );
}

function remove(capability: string, userId = target.id, lang = "deDE"): Promise<Response> {
  const params = new URLSearchParams({ userId, lang, capability });
  return DELETE(new Request(`https://example.com/api/grants?${params}`, { method: "DELETE" }));
}

describe("/api/grants", () => {
  it("refuses a language admin text, alone or among what they may give", async () => {
    expect((await put(["text"])).status).toBe(403);
    expect((await put(["edit", "text"])).status).toBe(403);
    expect(await grantsOf(target.id)).toEqual([]);
  });

  it("lets a language admin give the team's edit", async () => {
    expect((await put(["edit"])).status).toBe(200);
    expect(await grantsOf(target.id)).toEqual([{ lang: "deDE", capability: "edit" }]);
  });

  it("lets a site owner appoint, and a language admin not dismiss", async () => {
    who.viewer = { role: "admin", grants: [] };
    expect((await put(["text"])).status).toBe(200);
    who.viewer = { role: null, grants: [{ lang: "deDE", capability: "admin" }] };
    expect((await remove("text")).status).toBe(403);
    expect(await grantsOf(target.id)).toContainEqual({ lang: "deDE", capability: "text" });
  });

  it("refuses a language admin their own admin, and lets a site owner take it", async () => {
    expect((await remove("admin", granter.id)).status).toBe(403);
    who.viewer = { role: "admin", grants: [] };
    expect((await remove("admin", granter.id)).status).toBe(200);
  });

  it("lets the admin of a textByTeam language appoint and dismiss text there, not elsewhere", async () => {
    who.viewer = {
      role: null,
      grants: [{ lang: "xqGR", capability: "admin" }, { lang: "deDE", capability: "admin" }],
    };
    expect((await put(["text"], "xqGR")).status).toBe(200);
    const rows = await asSystem.query(`select 1 from "language_grant" where "userId" = $1 and "lang" = 'xqGR'`, [target.id]);
    expect(rows.rowCount).toBe(1);
    expect((await remove("text", target.id, "xqGR")).status).toBe(200);
    expect((await put(["text"], "deDE")).status).toBe(403);
  });
});
