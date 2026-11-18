/** Needs DATABASE_URL and migrations through 0116; the session is mocked. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, systemRows, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: "admin" } }),
}));

import { PATCH } from "./route";

let user: Awaited<ReturnType<typeof testUser>>;
let team = "";
const slug = `patch-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  user = await testUser("test-team-patch");
  who.id = user.id;
  [{ id: team }] = await systemRows<{ id: string }>(`insert into "team" ("slug", "name") values ($1, $1) returning "id"`, [slug]);
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1`, [slug]);
  await asSystem.query(`delete from "team" where "id" = $1`, [team]);
  await user.cleanup();
  await closeDb();
});

const patch = (body: unknown) =>
  PATCH(new Request(`http://x/api/teams/${team}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: team }),
  });

const stateOf = async () =>
  (await systemRows<{ name: string; ownStorage: boolean }>(`select "name", "ownStorage" from "team" where "id" = $1`, [team]))[0];

describe("PATCH /api/teams/[id]", () => {
  it("applies a name and ownStorage sent together", async () => {
    expect((await patch({ name: "Renamed", ownStorage: true })).status).toBe(200);
    expect(await stateOf()).toEqual({ name: "Renamed", ownStorage: true });
  });

  it("refuses a bad ownStorage by its own message, and changes nothing", async () => {
    const before = await stateOf();
    const res = await patch({ name: "Other", ownStorage: "false" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ownStorage is true or false.");
    expect(await stateOf()).toEqual(before);
  });
});
