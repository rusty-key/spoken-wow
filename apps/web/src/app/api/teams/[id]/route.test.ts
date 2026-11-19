/** Needs DATABASE_URL and migrations through 0120; the session is mocked. */
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
  (await systemRows<{ name: string; ownStorage: boolean; official: boolean }>(
    `select "name", "ownStorage", "official" from "team" where "id" = $1`,
    [team],
  ))[0];
const slugOf = async () => (await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [team]))[0].slug;

describe("PATCH /api/teams/[id]", () => {
  it("applies a name and ownStorage sent together", async () => {
    expect((await patch({ name: "Renamed", ownStorage: true })).status).toBe(200);
    expect(await stateOf()).toMatchObject({ name: "Renamed", ownStorage: true });
  });

  it("refuses a bad ownStorage by its own message, and changes nothing", async () => {
    const before = await stateOf();
    const res = await patch({ name: "Other", ownStorage: "false" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ownStorage is true or false.");
    expect(await stateOf()).toEqual(before);
  });

  it("sets official, and records it", async () => {
    await asSystem.query(`update "team" set "official" = true where "id" = $1`, [team]);
    expect((await patch({ official: false })).status).toBe(200);
    expect((await stateOf()).official).toBe(false);
    const logged = await systemRows<{ detail: unknown }>(
      `select "detail" from "activity" where "kind" = 'team.official' and "subject" = $1`,
      [slug],
    );
    expect(logged.map((row) => row.detail)).toEqual([{ official: false }]);
  });

  it("refuses an official that is not true or false, and changes nothing", async () => {
    const before = await stateOf();
    const res = await patch({ official: "no" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("official is true or false.");
    expect(await stateOf()).toEqual(before);
  });

  // The name is a line of every team pack's .toc and part of its title.
  it.each(["Two\nLines", "Tab\tbed", "Pipe|cffff0000Red", " ", "x".repeat(61)])(
    "refuses the name %j by its rule, and changes nothing",
    async (name) => {
      const before = await stateOf();
      const res = await patch({ name, ownStorage: !before.ownStorage });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("A team needs a name of 1 to 60 characters on one line, without |.");
      expect(await stateOf()).toEqual(before);
    },
  );

  it("keeps a name trimmed", async () => {
    expect((await patch({ name: "  Spaced  " })).status).toBe(200);
    expect((await stateOf()).name).toBe("Spaced");
  });

  // An installed team pack's folder carries the slug: a new one would orphan it (TEAM-RELEASES.md).
  it("never changes the slug", async () => {
    expect((await patch({ slug: "renamed-slug" })).status).toBe(400);
    expect(await slugOf()).toBe(slug);
  });
});
