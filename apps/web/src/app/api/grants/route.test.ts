/**
 * Who may appoint a text maintainer, with the session and its grants mocked and the writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
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
});

beforeEach(() => {
  who.viewer = { role: null, grants: [{ lang: "deDE", capability: "admin" }] };
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1`, [target.id]);
  await asSystem.query(`delete from "language_grant" where "userId" = $1`, [target.id]);
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [target.id]);
  await target.cleanup();
  await granter.cleanup();
  await closeDb();
});

function put(capabilities: string[]): Promise<Response> {
  return PUT(
    new Request("https://example.com/api/grants", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email(), lang: "deDE", capabilities }),
    }),
  );
}

function remove(capability: string): Promise<Response> {
  const params = new URLSearchParams({ userId: target.id, lang: "deDE", capability });
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
});
