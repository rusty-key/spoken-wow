/** Cloudflare's answers are a fake; nothing here reaches it or the database. */
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { accountsOf, authorization, CloudflareError, cookieFor, ensureBucket, exchangeCode, mintKey, pendingOf, suggestedBucket, type Pending } from "./cloudflare";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

beforeAll(() => {
  vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(32, 5).toString("base64"));
  vi.stubEnv("CLOUDFLARE_OAUTH_CLIENT_ID", "client");
  vi.stubEnv("CLOUDFLARE_OAUTH_CLIENT_SECRET", "secret");
  vi.stubEnv("CLOUDFLARE_OAUTH_SCOPES", "account:read r2:write");
});

afterAll(() => vi.unstubAllEnvs());

type Call = { method: string; path: string; body: unknown };

/** Cloudflare's API with an account that has the buckets named, recording every call. */
function cloudflare({ buckets = [] as string[], groups = [{ id: "g-write", name: "Workers R2 Storage Bucket Item Write" }] } = {}) {
  const calls: Call[] = [];
  const ok = (result: unknown) => Response.json({ success: true, errors: [], result });
  const impl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace("/client/v4", "");
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const bucket = path.match(/\/r2\/buckets\/([^/]+)$/)?.[1];
    if (method === "GET" && bucket) {
      return buckets.includes(bucket) ? ok({ name: bucket }) : Response.json({ success: false, errors: [{ message: "not found" }] }, { status: 404 });
    }
    if (method === "POST" && path.endsWith("/r2/buckets")) return ok({ name: "made" });
    if (path.endsWith("/tokens/permission_groups")) return ok(groups);
    if (method === "POST" && path.endsWith("/tokens")) return ok({ id: "token-id", value: "token-value" });
    return Response.json({ success: false, errors: [{ message: "unexpected" }] }, { status: 400 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("ensureBucket", () => {
  it("creates the bucket when the account has none by that name", async () => {
    const cf = cloudflare();
    expect(await ensureBucket("t", { accountId: ACCOUNT, bucket: "spoken-frfr" }, cf.impl)).toBe(true);
    expect(cf.calls.some((c) => c.method === "POST" && c.path.endsWith("/r2/buckets"))).toBe(true);
  });

  it("uses a bucket the account already has", async () => {
    const cf = cloudflare({ buckets: ["spoken-frfr"] });
    expect(await ensureBucket("t", { accountId: ACCOUNT, bucket: "spoken-frfr" }, cf.impl)).toBe(false);
    expect(cf.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("refuses a malformed account or bucket before asking Cloudflare", async () => {
    const cf = cloudflare();
    await expect(ensureBucket("t", { accountId: "../user", bucket: "ok-name" }, cf.impl)).rejects.toThrow("account id");
    await expect(ensureBucket("t", { accountId: ACCOUNT, bucket: "Bad_Name" }, cf.impl)).rejects.toThrow("bucket's name");
    expect(cf.calls).toEqual([]);
  });

  it("says which step Cloudflare refused, and that a grant may lack a permission", async () => {
    const impl = (async () => Response.json({ success: false, errors: [{ message: "Authentication error" }] }, { status: 403 })) as typeof fetch;
    await expect(ensureBucket("t", { accountId: ACCOUNT, bucket: "spoken-frfr" }, impl)).rejects.toThrow(
      "Cloudflare refused to look for the bucket: Authentication error. The grant may lack a permission this needs.",
    );
  });
});

describe("mintKey", () => {
  it("makes a key for the bucket alone, whose secret is the SHA-256 of the token", async () => {
    const cf = cloudflare();
    const key = await mintKey("t", { accountId: ACCOUNT, bucket: "spoken-frfr", keyName: "Spoken: x" }, cf.impl);
    expect(key).toEqual({ accessKeyId: "token-id", secretAccessKey: createHash("sha256").update("token-value").digest("hex") });
    const minted = cf.calls.find((c) => c.method === "POST" && c.path.endsWith("/tokens"))!;
    expect(minted.body).toEqual({
      name: "Spoken: x",
      policies: [{ effect: "allow", permission_groups: [{ id: "g-write" }], resources: { [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_spoken-frfr`]: "*" } }],
    });
  });

  it("stops when the account offers no bucket-scoped permission", async () => {
    const cf = cloudflare({ groups: [] });
    await expect(mintKey("t", { accountId: ACCOUNT, bucket: "spoken-frfr", keyName: "k" }, cf.impl)).rejects.toThrow("no \"Workers R2 Storage Bucket Item Write\"");
  });
});

describe("accountsOf", () => {
  it("reads every page of accounts", async () => {
    const pages: number[] = [];
    const impl = (async (input: string) => {
      const page = Number(new URL(input).searchParams.get("page"));
      pages.push(page);
      const count = page === 1 ? 50 : 3;
      const result = Array.from({ length: count }, (_, i) => ({ id: `${page}-${i}`, name: `Account ${page}-${i}`, type: "standard" }));
      return Response.json({ success: true, errors: [], result });
    }) as typeof fetch;
    const accounts = await accountsOf("t", impl);
    expect(pages).toEqual([1, 2]);
    expect(accounts).toHaveLength(53);
    expect(accounts[52]).toEqual({ id: "2-2", name: "Account 2-2" });
  });
});

describe("reaching Cloudflare", () => {
  it("names the step when Cloudflare does not answer at all", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(exchangeCode("c", "v", impl)).rejects.toThrow(CloudflareError);
    await expect(exchangeCode("c", "v", impl)).rejects.toThrow("Cloudflare did not answer while trying to hand over access (fetch failed): try again.");
    await expect(accountsOf("t", impl)).rejects.toThrow("while trying to list your accounts");
  });
});

describe("exchangeCode", () => {
  const answering = (body: object) => (async () => Response.json(body)) as unknown as typeof fetch;

  it("sees whether the admin let the site make keys", async () => {
    const without = await exchangeCode("c", "v", answering({ access_token: "a", expires_in: 60, scope: "account-settings.read workers-r2.write" }));
    expect(without).toEqual({ accessToken: "a", expiresIn: 60, mintsKeys: false });
    const granted = await exchangeCode("c", "v", answering({ access_token: "a", scope: "workers-r2.write account-api-tokens.write" }));
    expect(granted.mintsKeys).toBe(true);
  });

  it("takes an answer naming no scopes as every scope asked for", async () => {
    vi.stubEnv("CLOUDFLARE_OAUTH_SCOPES", "account-settings.read account-api-tokens.write");
    try {
      expect((await exchangeCode("c", "v", answering({ access_token: "a" }))).mintsKeys).toBe(true);
    } finally {
      vi.stubEnv("CLOUDFLARE_OAUTH_SCOPES", "account:read r2:write");
    }
  });
});

describe("the grant's cookie", () => {
  const withCookie = (header: string) => new Request("http://x/", { headers: { cookie: header.split(";")[0] } });
  const pending: Pending = { step: "connected", lang: "frFR", token: "abc", mintsKeys: false, until: Date.now() + 60_000 };

  it("opens for the person it was made for", () => {
    expect(pendingOf(withCookie(cookieFor("u1", pending)), "u1")).toEqual(pending);
  });

  it("does not open for anyone else, or once it has lapsed", () => {
    expect(pendingOf(withCookie(cookieFor("u1", pending)), "u2")).toBeNull();
    expect(pendingOf(withCookie(cookieFor("u1", { ...pending, until: Date.now() - 1 })), "u1")).toBeNull();
    expect(pendingOf(new Request("http://x/", { headers: { cookie: "spoken_cloudflare=junk" } }), "u1")).toBeNull();
  });

  it("is httpOnly, Lax and scoped to the Cloudflare routes", () => {
    expect(cookieFor("u1", pending)).toMatch(/; Path=\/api\/storage\/cloudflare; Max-Age=\d+; HttpOnly; SameSite=Lax/);
  });
});

describe("authorization", () => {
  it("asks for the configured scopes with an S256 challenge of a fresh verifier", () => {
    const { url, state, verifier } = authorization();
    const params = new URL(url).searchParams;
    expect(url.startsWith("https://dash.cloudflare.com/oauth2/auth?")).toBe(true);
    expect(params.get("scope")).toBe("account:read r2:write");
    expect(params.get("state")).toBe(state);
    expect(params.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(params.get("redirect_uri")).toMatch(/\/api\/storage\/cloudflare\/callback$/);
    expect(authorization().state).not.toBe(state);
  });
});

describe("suggestedBucket", () => {
  it("is a valid R2 name for a language", () => {
    expect(suggestedBucket("frFR")).toBe("spoken-frfr");
  });
});
