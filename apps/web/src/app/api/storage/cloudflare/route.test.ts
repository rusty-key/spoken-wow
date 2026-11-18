/** Needs DATABASE_URL and migrations through 0116; the session, Cloudflare, DNS and the bucket's answers are mocked. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryBlobs, useArchiveForTests } from "@/lib/blobs/store";
import { closeDb } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { addMember, asSystem, ownTeam, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: "member" } }),
}));

const probed = vi.hoisted(() => ({ probe: vi.fn(), WRITE_STEP: "Write an object" }));
vi.mock("@/lib/storage/probe", () => probed);

// Work after the response runs at once, so the revoke is seen when the route returns.
vi.mock("next/server", () => ({ after: (task: () => unknown) => void task() }));

// The account's endpoint is a real Cloudflare host: no lookup leaves the test.
vi.mock("@/lib/storage/host", () => ({ assertPublicHost: async () => {}, PrivateHostError: class extends Error {} }));

import { connectCloudflare } from "@/lib/storage/cloudflare";

import { GET as CALLBACK } from "./callback/route";
import { DELETE, GET, POST } from "./route";
import { GET as START } from "./start/route";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const OK = { ok: true, conditionalPut: true, steps: [{ name: "Write an object", ok: true }] };

let user: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
/** A second language the same person administers, so the admin gate cannot hide a mismatch. */
let de: Awaited<ReturnType<typeof ownTeam>>;
let restoreArchive = () => {};
let calls: string[] = [];
/** What the admin granted on Cloudflare's consent screen. */
let granted = "";
const ALL = "account-settings.read workers-r2.write account-api-tokens.write";

/** Cloudflare: its token endpoint, its revoke, and an account with no buckets. */
const cloudflare = (async (input: string, init?: RequestInit) => {
  const url = new URL(input);
  const method = init?.method ?? "GET";
  calls.push(`${method} ${url.pathname}`);
  const ok = (result: unknown) => Response.json({ success: true, errors: [], result });
  if (url.pathname === "/oauth2/token") return Response.json({ access_token: "cf-access", expires_in: 3600, scope: granted });
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

const ROUTE = "http://x/api/storage/cloudflare";
const start = (lang = "frFR") => START(new Request(`${ROUTE}/start?lang=${lang}`));
/** Cloudflare's answer to a start, as the callback receives it. */
const callback = (started: Response, query: string) => CALLBACK(withCookie(`${ROUTE}/callback?${query}`, cookieOf(started)));
const stateOf = (started: Response) => new URL(started.headers.get("location")!).searchParams.get("state")!;
const errorOf = (res: Response) => new URL(res.headers.get("location")!, "http://x").searchParams.get("cloudflare_error");
const get = (cookie: string, lang = "frFR") => GET(withCookie(`${ROUTE}?lang=${lang}`, cookie));
const post = (cookie: string, body: object) =>
  POST(withCookie(`${ROUTE}?lang=frFR`, cookie, { method: "POST", body: JSON.stringify({ accountId: ACCOUNT, bucket: "spoken-frfr", ...body }) }));

/** Start, and come back from Cloudflare with its code: the cookie holding the grant. */
async function grantedCookie(): Promise<string> {
  const started = await start();
  const back = await callback(started, `code=c&state=${stateOf(started)}`);
  expect(back.headers.get("location")).toBe("/admin/storage?lang=frFR&cloudflare=connected");
  return cookieOf(back);
}

beforeAll(async () => {
  vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("CLOUDFLARE_OAUTH_CLIENT_ID", "client");
  vi.stubEnv("CLOUDFLARE_OAUTH_CLIENT_SECRET", "secret");
  vi.stubEnv("CLOUDFLARE_OAUTH_SCOPES", ALL);
  vi.stubGlobal("fetch", cloudflare);
  user = await testUser("test-storage-cloudflare");
  who.id = user.id;
  fr = await ownTeam("frFR");
  de = await ownTeam("deDE");
  await addMember(fr.team, user.id, "frFR", "admin");
  await addMember(de.team, user.id, "deDE", "admin");
});

beforeEach(() => {
  calls = [];
  granted = ALL;
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
  await de.restore();
  await user.cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await closeDb();
});

const del = (cookie: string, lang = "frFR") => DELETE(withCookie(`${ROUTE}?lang=${lang}`, cookie, { method: "DELETE" }));
const FAILED_WRITE = { ok: false, conditionalPut: null, steps: [{ name: "Write an object", ok: false, detail: "HTTP 401" }] };
/** Setup called directly with no pause: a fake clock would also fire the database driver's timers. */
const connect = () =>
  connectCloudflare(fr.team, user.id, "cf-access", { accountId: ACCOUNT, bucket: "spoken-frfr", label: "spoken-frfr", key: null }, { mintsKeys: true, pauseMs: 0 });

describe("connecting Cloudflare", () => {
  it("lets only the language's admins start", async () => {
    expect((await start(BASE_LANG)).status).toBe(403);
  });

  it("sends the admin to Cloudflare with a sealed, scoped cookie", async () => {
    const res = await start();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^https:\/\/dash\.cloudflare\.com\/oauth2\/auth\?/);
    expect(res.headers.get("set-cookie")).toContain("Path=/api/storage/cloudflare");
    expect(res.headers.get("set-cookie")).not.toContain("frFR");
  });

  it("refuses an answer for another connection, or without one started", async () => {
    const started = await start();
    const forged = await callback(started, "code=c&state=other");
    expect(errorOf(forged)).toContain("not for this connection");
    // Any page can link here: a stray answer must not end the setup in progress.
    expect(forged.headers.get("set-cookie")).toBeNull();
    const none = await CALLBACK(new Request(`${ROUTE}/callback?code=c&state=s`));
    expect(errorOf(none)).toContain("start it again");
    expect(none.headers.get("set-cookie")).toBeNull();
    expect(calls).not.toContain("POST /oauth2/token");

    const real = await callback(started, `code=c&state=${stateOf(started)}`);
    expect(real.headers.get("location")).toBe("/admin/storage?lang=frFR&cloudflare=connected");
  });

  it("says when the admin declined at Cloudflare", async () => {
    const started = await start();
    expect(errorOf(await callback(started, `error=access_denied&state=${stateOf(started)}`))).toBe("Cloudflare did not grant access: access_denied");
  });

  it("makes the bucket and its key, saves and tests it, and lets go of the grant", async () => {
    const cookie = await grantedCookie();
    expect(await (await get(cookie)).json()).toEqual({ accounts: [{ id: ACCOUNT, name: "Team account" }], bucket: "spoken-frfr", mintsKeys: true });

    const res = await post(cookie, {});
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

  it("makes only the bucket when the admin declined to let it make keys, then takes the key they paste", async () => {
    granted = "account-settings.read workers-r2.write";
    const cookie = await grantedCookie();
    expect((await (await get(cookie)).json()).mintsKeys).toBe(false);

    const first = await post(cookie, {});
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toBeNull();
    expect(await first.json()).toEqual({ needsKey: true });
    expect(calls).toContain(`POST /client/v4/accounts/${ACCOUNT}/r2/buckets`);

    expect((await post(cookie, { accessKeyId: "pasted-id" })).status).toBe(400);

    const second = await post(cookie, { accessKeyId: "pasted-id", secretAccessKey: "pasted-secret" });
    expect(second.status).toBe(201);
    expect(second.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await second.json()).backend).toMatchObject({ accessKeyId: "pasted-id", health: "ok" });
    expect(calls.some((call) => call.endsWith("/tokens") || call.endsWith("/tokens/permission_groups"))).toBe(false);
    expect(calls).toContain("POST /oauth2/revoke");
  });

  it("tests a new key again while it reaches R2", async () => {
    probed.probe.mockResolvedValueOnce(FAILED_WRITE);
    const done = await connect();
    expect(probed.probe).toHaveBeenCalledTimes(2);
    expect("backend" in done && done.backend.health).toBe("ok");
  });

  it("does not test again a bucket that failed past its first write", async () => {
    probed.probe.mockResolvedValue({ ok: false, conditionalPut: true, steps: [{ name: "Write an object", ok: true }, { name: "Read its size", ok: false }] });
    const done = await connect();
    expect(probed.probe).toHaveBeenCalledTimes(1);
    expect("backend" in done && done.backend.health).toBe("failing");
  });

  it("keeps a saved bucket when its test throws, so a retry makes no second key", async () => {
    // The first test fails; the retry then throws, as a lost key or database would, before it probes.
    probed.probe.mockImplementationOnce(async () => {
      vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(32, 9).toString("base64"));
      return FAILED_WRITE;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const done = await connect();
      expect("backend" in done && done.test).toBeNull();
      const { rows } = await asSystem.query(`select "accessKeyId" from "storage_backend" where "teamId" = $1`, [fr.team]);
      expect(rows).toEqual([{ accessKeyId: "minted-id" }]);
    } finally {
      vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(32, 3).toString("base64"));
      error.mockRestore();
    }
  });

  it("keeps the grant when Cloudflare refuses, so the admin can try another name", async () => {
    const cookie = await grantedCookie();
    const res = await post(cookie, { bucket: "Bad_Name" });
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await get(cookie)).status).toBe(200);
  });

  it("refuses a grant made for another language, and revokes one cancelled", async () => {
    const cookie = await grantedCookie();
    expect((await get(cookie, BASE_LANG)).status).toBe(403);
    expect((await del(cookie)).status).toBe(204);
    expect(calls).toContain("POST /oauth2/revoke");
  });

  it("leaves a grant for one language alone when the admin cancels in another", async () => {
    const cookie = await grantedCookie();
    expect((await get(cookie, "deDE")).status).toBe(409);
    const res = await del(cookie, "deDE");
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(calls).not.toContain("POST /oauth2/revoke");
    expect((await get(cookie)).status).toBe(200);
  });

  it("answers 404 to a start when Cloudflare is not set up", async () => {
    vi.stubEnv("CLOUDFLARE_OAUTH_SCOPES", "");
    try {
      expect((await start()).status).toBe(404);
    } finally {
      vi.stubEnv("CLOUDFLARE_OAUTH_SCOPES", ALL);
    }
  });
});
