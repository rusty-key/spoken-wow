/** Needs DATABASE_URL and migrations through 0116; the session, Cloudflare, DNS and the bucket's answers are mocked. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryBlobs, useArchiveForTests } from "@/lib/blobs/store";
import { closeDb } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { asSystem, ownTeam, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: "member" } }),
}));

const probed = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("@/lib/storage/probe", () => probed);

// The account's endpoint is a real Cloudflare host: no lookup leaves the test.
vi.mock("@/lib/storage/host", () => ({ assertPublicHost: async () => {}, PrivateHostError: class extends Error {} }));

import { GET as CALLBACK } from "./callback/route";
import { DELETE, GET, POST } from "./route";
import { GET as START } from "./start/route";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const OK = { ok: true, conditionalPut: true, steps: [{ name: "Write an object", ok: true }] };

let user: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let restoreArchive = () => {};
let calls: string[] = [];

/** Cloudflare: its token endpoint, its revoke, and an account with no buckets. */
const cloudflare = (async (input: string, init?: RequestInit) => {
  const url = new URL(input);
  const method = init?.method ?? "GET";
  calls.push(`${method} ${url.pathname}`);
  const ok = (result: unknown) => Response.json({ success: true, errors: [], result });
  if (url.pathname === "/oauth2/token") return Response.json({ access_token: "cf-access", expires_in: 3600 });
  if (url.pathname === "/oauth2/revoke") return new Response(null, { status: 200 });
  const path = url.pathname.replace("/client/v4", "");
  if (path === "/accounts") return ok([{ id: ACCOUNT, name: "Team account", type: "standard" }]);
  if (method === "GET" && path.includes("/r2/buckets/")) return Response.json({ success: false, errors: [] }, { status: 404 });
  if (method === "POST" && path.endsWith("/r2/buckets")) return ok({});
  if (path.endsWith("/tokens/permission_groups")) return ok([{ id: "g", name: "Workers R2 Storage Bucket Item Write" }]);
  if (method === "POST" && path.endsWith("/tokens")) return ok({ id: "minted-id", value: "minted-value" });
  return Response.json({ success: false, errors: [{ message: `unexpected ${method} ${path}` }] }, { status: 400 });
}) as typeof fetch;

/** The cookie a response set, as a browser would send it back. */
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];
const withCookie = (url: string, cookie: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { ...(init.headers ?? {}), cookie } });

/** Start, and come back from Cloudflare with its code: the cookie holding the grant. */
async function granted(): Promise<string> {
  const start = await START(new Request("http://x/api/storage/cloudflare/start?lang=frFR"));
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const back = await CALLBACK(withCookie(`http://x/api/storage/cloudflare/callback?code=c&state=${state}`, cookieOf(start)));
  expect(back.headers.get("location")).toBe("/admin/storage?lang=frFR&cloudflare=connected");
  return cookieOf(back);
}

beforeAll(async () => {
  vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("CLOUDFLARE_OAUTH_CLIENT_ID", "client");
  vi.stubEnv("CLOUDFLARE_OAUTH_CLIENT_SECRET", "secret");
  vi.stubEnv("CLOUDFLARE_OAUTH_SCOPES", "account:read");
  vi.stubGlobal("fetch", cloudflare);
  user = await testUser("test-storage-cloudflare");
  who.id = user.id;
  fr = await ownTeam("frFR");
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy") values ($1, $2, 'frFR', 'admin', $2)`,
    [fr.team, user.id],
  );
});

beforeEach(() => {
  calls = [];
  probed.probe.mockReset().mockResolvedValue(OK);
  restoreArchive = useArchiveForTests(memoryBlobs(), "r2");
});

afterEach(async () => {
  restoreArchive();
  await asSystem.query(`delete from "storage_backend" where "teamId" = $1`, [fr.team]);
});

afterAll(async () => {
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [user.id]);
  await fr.restore();
  await user.cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await closeDb();
});

describe("connecting Cloudflare", () => {
  it("lets only the language's admins start", async () => {
    expect((await START(new Request(`http://x/api/storage/cloudflare/start?lang=${BASE_LANG}`))).status).toBe(403);
  });

  it("sends the admin to Cloudflare with a sealed, scoped cookie", async () => {
    const res = await START(new Request("http://x/api/storage/cloudflare/start?lang=frFR"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^https:\/\/dash\.cloudflare\.com\/oauth2\/auth\?/);
    expect(res.headers.get("set-cookie")).toContain("Path=/api/storage/cloudflare");
    expect(res.headers.get("set-cookie")).not.toContain("frFR");
  });

  it("refuses an answer for another connection, or without one started", async () => {
    const start = await START(new Request("http://x/api/storage/cloudflare/start?lang=frFR"));
    const forged = await CALLBACK(withCookie("http://x/api/storage/cloudflare/callback?code=c&state=other", cookieOf(start)));
    expect(new URL(forged.headers.get("location")!, "http://x").searchParams.get("cloudflare_error")).toContain("not for this connection");
    const none = await CALLBACK(new Request("http://x/api/storage/cloudflare/callback?code=c&state=s"));
    expect(new URL(none.headers.get("location")!, "http://x").searchParams.get("cloudflare_error")).toContain("start it again");
    expect(calls).not.toContain("POST /oauth2/token");
  });

  it("says when the admin declined at Cloudflare", async () => {
    const start = await START(new Request("http://x/api/storage/cloudflare/start?lang=frFR"));
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await CALLBACK(withCookie(`http://x/api/storage/cloudflare/callback?error=access_denied&state=${state}`, cookieOf(start)));
    expect(new URL(res.headers.get("location")!, "http://x").searchParams.get("cloudflare_error")).toBe("Cloudflare did not grant access: access_denied");
  });

  it("makes the bucket and its key, saves and tests it, and lets go of the grant", async () => {
    const cookie = await granted();
    const accounts = await (await GET(withCookie("http://x/api/storage/cloudflare?lang=frFR", cookie))).json();
    expect(accounts).toEqual({ accounts: [{ id: ACCOUNT, name: "Team account" }], bucket: "spoken-frfr" });

    const res = await POST(withCookie("http://x/api/storage/cloudflare?lang=frFR", cookie, { method: "POST", body: JSON.stringify({ accountId: ACCOUNT, bucket: "spoken-frfr" }) }));
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const { backend, test } = await res.json();
    expect(test.ok).toBe(true);
    expect(backend).toMatchObject({
      provider: "r2",
      endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
      bucket: "spoken-frfr",
      accessKeyId: "minted-id",
      health: "ok",
      writing: false,
    });
    expect(calls).toContain("POST /oauth2/revoke");
  });

  it("tests a new key again while it reaches R2", async () => {
    const cookie = await granted();
    probed.probe.mockResolvedValueOnce({ ok: false, conditionalPut: null, steps: [{ name: "Write an object", ok: false, detail: "HTTP 401" }] });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pending = POST(withCookie("http://x/api/storage/cloudflare?lang=frFR", cookie, { method: "POST", body: JSON.stringify({ accountId: ACCOUNT, bucket: "spoken-frfr" }) }));
      await vi.waitFor(() => expect(probed.probe).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(3_000);
      const { backend } = await (await pending).json();
      expect(probed.probe).toHaveBeenCalledTimes(2);
      expect(backend.health).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the grant when Cloudflare refuses, so the admin can try another name", async () => {
    const cookie = await granted();
    const res = await POST(withCookie("http://x/api/storage/cloudflare?lang=frFR", cookie, { method: "POST", body: JSON.stringify({ accountId: ACCOUNT, bucket: "Bad_Name" }) }));
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await GET(withCookie("http://x/api/storage/cloudflare?lang=frFR", cookie))).status).toBe(200);
  });

  it("refuses a grant made for another language, and revokes one cancelled", async () => {
    const cookie = await granted();
    expect((await GET(withCookie(`http://x/api/storage/cloudflare?lang=${BASE_LANG}`, cookie))).status).toBe(403);
    const res = await DELETE(withCookie("http://x/api/storage/cloudflare?lang=frFR", cookie, { method: "DELETE" }));
    expect(res.status).toBe(204);
    expect(calls).toContain("POST /oauth2/revoke");
  });
});
