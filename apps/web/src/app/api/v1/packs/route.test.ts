/**
 * The pack routes behind a Bearer token, against a real Postgres. Needs DATABASE_URL and
 * migrations through 0132.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";
import { createToken } from "@/lib/tokens/store";

import { POST as submit } from "./[id]/submissions/route";
import { GET, POST } from "./route";

const ID = `test-v1packs-${randomUUID().slice(0, 6)}`;
const body = (over: Record<string, unknown> = {}) => ({
  id: ID,
  lang: "deDE",
  section: "quests",
  title: "Title",
  author: "Somebody",
  description: "A pack for tests.",
  version: "1.0.0",
  size: 1234,
  sha256: "c".repeat(64),
  url: "https://github.com/someone/pack/releases/download/v1.0.0/pack.zip",
  ...over,
});
const headers = (token?: string) => (token ? { authorization: `Bearer ${token}` } : undefined);
const post = (payload: unknown, token?: string) =>
  POST(new Request("http://localhost/api/v1/packs", { method: "POST", headers: headers(token), body: JSON.stringify(payload) }));
const list = (token?: string) => GET(new Request("http://localhost/api/v1/packs", { headers: headers(token) }));
const ctx = { params: Promise.resolve({ id: ID }) };

let user: Awaited<ReturnType<typeof testUser>>;
let info: ReturnType<typeof vi.spyOn>;
let packsToken: string;
let textToken: string;

beforeAll(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  user = await testUser("test-v1packs");
  const expiresAt = new Date(Date.now() + 86_400_000);
  ({ token: packsToken } = await createToken({
    userId: user.id,
    lang: null,
    access: "none",
    generate: false,
    packs: true,
    label: "packs",
    expiresAt,
  }));
  ({ token: textToken } = await createToken({
    userId: user.id,
    lang: "deDE",
    access: "write",
    generate: false,
    label: "text",
    expiresAt,
  }));
});

afterAll(async () => {
  info.mockRestore();
  await asSystem.query(`delete from "activity" where "kind" like 'pack.%' and "subject" = $1`, [ID]);
  await asSystem.query(`delete from "community_pack" where "id" = $1`, [ID]);
  await user?.cleanup();
  await closeDb();
});

describe("/api/v1/packs", () => {
  it("401 with no token or an unknown one", async () => {
    expect((await list()).status).toBe(401);
    expect((await post(body(), "spk_nothing")).status).toBe(401);
  });

  it("403 for a token without the packs scope", async () => {
    const response = await post(body(), textToken);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "this token cannot submit community packs" });
    expect((await list(textToken)).status).toBe(403);
    const again = await submit(
      new Request("http://localhost", { method: "POST", headers: headers(textToken), body: "{}" }),
      ctx,
    );
    expect(again.status).toBe(403);
  });

  it("answers a broken form with 400 and an error per field", async () => {
    const response = await post(body({ id: "Not Valid", sha256: "xyz" }), packsToken);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(Object.keys(json.errors).sort()).toEqual(["id", "sha256"]);
  });

  it("creates, lists and submits a version as the token's owner", async () => {
    const created = await post(body(), packsToken);
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ id: ID, ownerId: user.id, pending: { version: "1.0.0" } });

    const listed = await (await list(packsToken)).json();
    expect(listed.packs.map((p: { id: string }) => p.id)).toContain(ID);

    const { id: _id, lang: _lang, section: _section, ...fields } = body({ version: "1.1.0" });
    const again = await submit(
      new Request("http://localhost", { method: "POST", headers: headers(packsToken), body: JSON.stringify(fields) }),
      ctx,
    );
    expect(again.status).toBe(409);
  });
});
