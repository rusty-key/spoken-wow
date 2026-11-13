/** The author routes against a real Postgres. Needs DATABASE_URL and migrations through 0107. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "", role: "member" as string, signedIn: true }));

vi.mock("@/lib/session", () => ({
  currentSession: async () =>
    who.signedIn ? { user: { id: who.id, email: "a@example.invalid", role: who.role } } : null,
}));

import { POST as submit } from "./[id]/submissions/route";
import { DELETE as withdraw } from "./[id]/submissions/pending/route";
import { GET, POST } from "./route";

const ID = `test-authorroute-${randomUUID().slice(0, 6)}`;
const body = (over: Record<string, unknown> = {}) => ({
  id: ID,
  lang: "deDE",
  section: "quests",
  title: "Title",
  author: "Somebody",
  description: "A pack for tests.",
  version: "1.0.0",
  size: 1234,
  sha256: "b".repeat(64),
  url: "https://github.com/someone/pack/releases/download/v1.0.0/pack.zip",
  ...over,
});
const post = (payload: unknown) =>
  POST(new Request("http://localhost/api/packs", { method: "POST", body: JSON.stringify(payload) }));
const ctx = { params: Promise.resolve({ id: ID }) };

let user: Awaited<ReturnType<typeof testUser>>;
let info: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  user = await testUser("test-authorroute");
  who.id = user.id;
});

beforeEach(() => {
  who.signedIn = true;
});

afterAll(async () => {
  info.mockRestore();
  await asSystem.query(`delete from "activity" where "kind" like 'pack.%' and "subject" = $1`, [ID]);
  await asSystem.query(`delete from "community_pack" where "id" = $1`, [ID]);
  await user?.cleanup();
  await closeDb();
});

describe("author routes", () => {
  it("refuse a signed-out visitor with 403", async () => {
    who.signedIn = false;
    expect((await GET()).status).toBe(403);
    expect((await post(body())).status).toBe(403);
    expect((await withdraw(new Request("http://localhost"), ctx)).status).toBe(403);
  });

  it("answer a broken form with 400 and an error per field", async () => {
    const response = await post(body({ id: "Not Valid", sha256: "xyz" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(Object.keys(json.errors).sort()).toEqual(["id", "sha256"]);
  });

  it("treat a body that is not JSON as a broken form", async () => {
    const response = await POST(new Request("http://localhost/api/packs", { method: "POST", body: "nope" }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toHaveProperty("form");
  });

  it("let a member create, list, resubmit and withdraw", async () => {
    const created = await post(body());
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ id: ID, ownerId: user.id, pending: { version: "1.0.0" } });

    expect((await post(body())).status).toBe(409);

    const listed = await (await GET()).json();
    expect(listed.packs.map((p: { id: string }) => p.id)).toContain(ID);

    const { id: _id, lang: _lang, section: _section, ...fields } = body({ version: "1.1.0" });
    const again = await submit(
      new Request("http://localhost", { method: "POST", body: JSON.stringify(fields) }),
      ctx,
    );
    expect(again.status).toBe(409);

    const gone = await withdraw(new Request("http://localhost", { method: "DELETE" }), ctx);
    expect(gone.status).toBe(200);
    expect((await withdraw(new Request("http://localhost", { method: "DELETE" }), ctx)).status).toBe(404);
  });
});
