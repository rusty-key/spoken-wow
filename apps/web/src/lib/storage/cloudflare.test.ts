/** Cloudflare's answers are a fake; nothing here reaches it or the database. */
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { authorization, cookieFor, makeBucket, pendingOf, suggestedBucket, type Pending } from "./cloudflare";

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

describe("makeBucket", () => {
  it("creates the bucket and a key for it alone, whose secret is the SHA-256 of the token", async () => {
    const cf = cloudflare();
    const made = await makeBucket("t", { accountId: ACCOUNT, bucket: "spoken-frfr", keyName: "Spoken: x" }, cf.impl);
    expect(made).toEqual({
      endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
      bucket: "spoken-frfr",
      accessKeyId: "token-id",
      secretAccessKey: createHash("sha256").update("token-value").digest("hex"),
      created: true,
    });
    expect(cf.calls.some((c) => c.method === "POST" && c.path.endsWith("/r2/buckets"))).toBe(true);
    const minted = cf.calls.find((c) => c.method === "POST" && c.path.endsWith("/tokens"))!;
    expect(minted.body).toEqual({
      name: "Spoken: x",
      policies: [{ effect: "allow", permission_groups: [{ id: "g-write" }], resources: { [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_spoken-frfr`]: "*" } }],
    });
  });

  it("uses a bucket the account already has", async () => {
    const cf = cloudflare({ buckets: ["spoken-frfr"] });
    const made = await makeBucket("t", { accountId: ACCOUNT, bucket: "spoken-frfr", keyName: "k" }, cf.impl);
    expect(made.created).toBe(false);
    expect(cf.calls.some((c) => c.method === "POST" && c.path.endsWith("/r2/buckets"))).toBe(false);
  });

  it("refuses a malformed account or bucket before asking Cloudflare", async () => {
    const cf = cloudflare();
    await expect(makeBucket("t", { accountId: "../user", bucket: "ok-name", keyName: "k" }, cf.impl)).rejects.toThrow("account id");
    await expect(makeBucket("t", { accountId: ACCOUNT, bucket: "Bad_Name", keyName: "k" }, cf.impl)).rejects.toThrow("bucket's name");
    expect(cf.calls).toEqual([]);
  });

  it("says which step Cloudflare refused, and that a grant may lack a permission", async () => {
    const impl = (async () => Response.json({ success: false, errors: [{ message: "Authentication error" }] }, { status: 403 })) as typeof fetch;
    await expect(makeBucket("t", { accountId: ACCOUNT, bucket: "spoken-frfr", keyName: "k" }, impl)).rejects.toThrow(
      "Cloudflare refused to look for the bucket: Authentication error. The grant may lack a permission this needs.",
    );
  });

  it("stops when the account offers no bucket-scoped permission", async () => {
    const cf = cloudflare({ groups: [] });
    await expect(makeBucket("t", { accountId: ACCOUNT, bucket: "spoken-frfr", keyName: "k" }, cf.impl)).rejects.toThrow("no \"Workers R2 Storage Bucket Item Write\"");
  });
});

describe("the grant's cookie", () => {
  const withCookie = (header: string) => new Request("http://x/", { headers: { cookie: header.split(";")[0] } });
  const pending: Pending = { step: "connected", lang: "frFR", token: "abc", until: Date.now() + 60_000 };

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
