/**
 * Connecting an R2 bucket through Cloudflare's OAuth (docs/platform/STORAGE.md, "Connecting
 * Cloudflare"): the team admin grants the site access to their account, the site creates the bucket
 * and a key for that bucket alone, and forgets the grant. Only the bucket's key is kept, as for a
 * bucket entered by hand.
 *
 * Off unless CLOUDFLARE_OAUTH_CLIENT_ID, CLOUDFLARE_OAUTH_CLIENT_SECRET and CLOUDFLARE_OAUTH_SCOPES
 * are set and a secret can be sealed.
 */
import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { canSeal, seal, SealError, unseal } from "@/lib/blobs/seal";
import type { Lang } from "@/lib/lang";
import { hashSecret } from "@/lib/secret-token";
import { SITE } from "@/lib/site";
import type { TeamId } from "@/lib/teams/store";

import { backendInput, backendView, createBackend, StorageError, testBackend, type BackendView } from "./backends";
import { errorText } from "./error-text";
import { WRITE_STEP, type ProbeResult } from "./probe";

const AUTHORIZE = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN = "https://dash.cloudflare.com/oauth2/token";
const REVOKE = "https://dash.cloudflare.com/oauth2/revoke";
const API = "https://api.cloudflare.com/client/v4";

/** The permission group a bucket's key gets: read, write and list objects in that one bucket. */
const OBJECT_WRITE = "Workers R2 Storage Bucket Item Write";

/** The scope that lets the site make the bucket's key. Optional on the consent screen: without it the admin makes the key. */
const KEY_SCOPE = "account-api-tokens.write";

const CALLBACK_PATH = "/api/storage/cloudflare/callback";

/** A refusal from Cloudflare, or a step of the setup that could not go on; the storage gate answers it like any StorageError. */
export class CloudflareError extends StorageError {
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message, status);
    this.name = "CloudflareError";
  }
}

type Config = { clientId: string; clientSecret: string; scopes: string };

function config(): Config | null {
  const clientId = process.env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET?.trim();
  const scopes = process.env.CLOUDFLARE_OAUTH_SCOPES?.trim().split(/[\s,]+/).filter(Boolean).join(" ");
  return clientId && clientSecret && scopes ? { clientId, clientSecret, scopes } : null;
}

/** Whether the Storage page offers to connect Cloudflare. */
export const cloudflareReady = (): boolean => config() !== null && canSeal();

function required(): Config {
  const found = config();
  if (!found) throw new CloudflareError("Connecting Cloudflare is not set up on this site.", 404);
  return found;
}

const redirectUri = () => `${SITE}${CALLBACK_PATH}`;

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** Where to send the admin, with a fresh state and PKCE verifier to keep until they come back. */
export function authorization(): { url: string; state: string; verifier: string } {
  const { clientId, scopes } = required();
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: scopes,
    state,
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state, verifier };
}

type Fetch = typeof fetch;

/** A request to Cloudflare; one that never gets an answer is a CloudflareError naming what it was for. */
async function reach(fetchImpl: Fetch, doing: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, redirect: "manual" });
  } catch (error) {
    throw new CloudflareError(`Cloudflare did not answer while trying to ${doing} (${errorText(error)}): try again.`);
  }
}

const basic = ({ clientId, clientSecret }: Config) =>
  `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;

/**
 * The access token the code is worth, how many seconds it lasts, and whether the admin granted
 * KEY_SCOPE. A token answer that names no scopes granted every one asked for (RFC 6749, 5.1).
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: Fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number; mintsKeys: boolean }> {
  const conf = required();
  const res = await reach(fetchImpl, "hand over access", TOKEN, {
    method: "POST",
    headers: { authorization: basic(conf), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown; error_description?: unknown }
    | null;
  if (!res.ok || typeof body?.access_token !== "string") {
    const why = typeof body?.error_description === "string" ? body.error_description : typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new CloudflareError(`Cloudflare did not hand over access: ${why}`);
  }
  const granted = (typeof body.scope === "string" ? body.scope : conf.scopes).split(/\s+/);
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
    mintsKeys: granted.includes(KEY_SCOPE),
  };
}

/**
 * Best effort: a token that outlives the setup lapses on its own within the hour, and the admin can
 * revoke it under Connected Applications in Cloudflare. A refusal is logged, not shown.
 */
export async function revoke(accessToken: string, fetchImpl: Fetch = fetch): Promise<void> {
  const conf = config();
  if (!conf) return;
  await fetchImpl(REVOKE, {
    method: "POST",
    headers: { authorization: basic(conf), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (res) => {
      await res.body?.cancel();
      if (!res.ok) console.warn(`storage: Cloudflare refused to revoke a setup grant: HTTP ${res.status}`);
    })
    .catch((error: unknown) => console.warn(`storage: revoking a Cloudflare setup grant failed: ${errorText(error)}`));
}

type Envelope<T> = { success?: boolean; result?: T; errors?: { code?: number; message?: string }[] };

/** One call to Cloudflare's API; a refusal throws naming `doing`. Null on a 404 when `missingOk`. */
async function api<T>(
  token: string,
  doing: string,
  path: string,
  { method = "GET", body, missingOk = false, fetchImpl = fetch }: { method?: string; body?: unknown; missingOk?: boolean; fetchImpl?: Fetch } = {},
): Promise<T | null> {
  const res = await reach(fetchImpl, doing, `${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (missingOk && res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  const answer = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !answer?.success) {
    const why = answer?.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
    const hint = res.status === 403 ? " The grant may lack a permission this needs." : "";
    throw new CloudflareError(`Cloudflare refused to ${doing}: ${why}.${hint}`);
  }
  return answer.result as T;
}

export type CloudflareAccount = { id: string; name: string };

/** Pages of 50 until a short one; bounded, since the chooser is a select. */
const ACCOUNT_PAGES = 20;

export async function accountsOf(token: string, fetchImpl: Fetch = fetch): Promise<CloudflareAccount[]> {
  const accounts: CloudflareAccount[] = [];
  for (let page = 1; page <= ACCOUNT_PAGES; page++) {
    const rows = (await api<{ id: string; name: string }[]>(token, "list your accounts", `/accounts?per_page=50&page=${page}`, { fetchImpl })) ?? [];
    accounts.push(...rows.map(({ id, name }) => ({ id, name })));
    if (rows.length < 50) break;
  }
  return accounts;
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** R2's own rule for a bucket's name. */
const R2_BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** What the bucket is called unless the admin says otherwise. */
export const suggestedBucket = (lang: Lang): string => `spoken-${lang.toLowerCase()}`.replace(/[^a-z0-9-]/g, "-");

function checkNames(accountId: string, bucket: string): void {
  if (!ACCOUNT_ID.test(accountId)) throw new CloudflareError("That is not a Cloudflare account id.");
  if (!R2_BUCKET.test(bucket)) throw new CloudflareError("The bucket's name is 3 to 63 lowercase letters, digits and dashes, starting and ending with a letter or digit.");
}

/**
 * The bucket, created unless the account has one by that name. Default jurisdiction only: an EU or
 * FedRAMP bucket is connected by hand.
 */
export async function ensureBucket(
  token: string,
  { accountId, bucket }: { accountId: string; bucket: string },
  fetchImpl: Fetch = fetch,
): Promise<void> {
  checkNames(accountId, bucket);
  const account = `/accounts/${accountId}`;
  const found = await api(token, "look for the bucket", `${account}/r2/buckets/${bucket}`, { missingOk: true, fetchImpl });
  if (!found) await api(token, "create the bucket", `${account}/r2/buckets`, { method: "POST", body: { name: bucket }, fetchImpl });
}

type BucketKey = { accessKeyId: string; secretAccessKey: string };

/**
 * A new key for the bucket alone, which needs KEY_SCOPE. An R2 key is an API token: its id is the
 * access key id and the SHA-256 of its value the secret.
 */
export async function mintKey(
  token: string,
  { accountId, bucket, keyName }: { accountId: string; bucket: string; keyName: string },
  fetchImpl: Fetch = fetch,
): Promise<BucketKey> {
  const account = `/accounts/${accountId}`;
  const groups = (await api<{ id: string; name: string }[]>(token, "list the permissions a key can have", `${account}/tokens/permission_groups`, { fetchImpl })) ?? [];
  const group = groups.find((g) => g.name === OBJECT_WRITE);
  if (!group) throw new CloudflareError(`Cloudflare offers no "${OBJECT_WRITE}" permission to give the bucket's key.`);
  const minted = await api<{ id: string; value: string }>(token, "create the bucket's key", `${account}/tokens`, {
    method: "POST",
    body: {
      name: keyName,
      policies: [{ effect: "allow", permission_groups: [{ id: group.id }], resources: { [`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket}`]: "*" } }],
    },
    fetchImpl,
  });
  if (!minted?.id || !minted.value) throw new CloudflareError("Cloudflare created the bucket's key but did not show it.");
  return { accessKeyId: minted.id, secretAccessKey: hashSecret(minted.value) };
}

type Connected = { backend: BackendView; test: ProbeResult | null };

/**
 * Without a key: makes the bucket and a key for it when the grant allows, else answers `needsKey`
 * (with Cloudflare's reason when making the key failed). With the key the admin pasted, the bucket
 * already exists and no grant is needed. Then saves and tests it.
 */
export async function connectCloudflare(
  team: TeamId,
  userId: string,
  token: string | null,
  { accountId, bucket, label, key }: { accountId: string; bucket: string; label: string; key: BucketKey | null },
  { mintsKeys, fetchImpl = fetch, tries = 5, pauseMs = 3_000 }: { mintsKeys: boolean; fetchImpl?: Fetch; tries?: number; pauseMs?: number },
): Promise<Connected | { needsKey: true; why?: string }> {
  checkNames(accountId, bucket);
  if (!key) {
    if (!token) throw new CloudflareError("No Cloudflare grant is waiting, or it lapsed: connect Cloudflare again.", 409);
    await ensureBucket(token, { accountId, bucket }, fetchImpl);
    if (!mintsKeys) return { needsKey: true };
    try {
      key = await mintKey(token, { accountId, bucket, keyName: `Spoken: ${label}` }, fetchImpl);
    } catch (error) {
      if (error instanceof CloudflareError) return { needsKey: true, why: error.message };
      throw error;
    }
  }
  const { accessKeyId, secretAccessKey } = key;
  const backend = await createBackend(
    team,
    backendInput({ provider: "r2", label, endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: "auto", bucket, pathStyle: true, accessKeyId, secretAccessKey }),
    userId,
  );
  // Saved from here on: a retried POST would make a second key, so nothing after this fails the
  // request. A test that throws leaves the bucket untested, and its card offers the test again.
  // A new key can take a few seconds to reach R2, so only a refused first write is tried again.
  let test: ProbeResult | null = null;
  try {
    for (let attempt = 1; attempt <= tries; attempt++) {
      test = await testBackend(team, backend.id);
      if (!test || test.ok || test.steps[0]?.name !== WRITE_STEP || test.steps[0].ok || attempt === tries) break;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  } catch (error) {
    console.error(`storage: testing the Cloudflare bucket ${backend.id} after setup failed:`, error);
    test = null;
  }
  return { backend: await backendView(team, backend.id).catch(() => backend), test };
}

/*
 * The cookie between the steps, sealed and bound to the person: first the state and PKCE verifier
 * while they are at Cloudflare, then the access token until the bucket is made. Path-scoped to these
 * routes, httpOnly, and gone within minutes.
 */

const COOKIE = "spoken_cloudflare";

export type Pending =
  | { step: "authorize"; lang: Lang; state: string; verifier: string; until: number }
  | { step: "connected"; lang: Lang; token: string; mintsKeys: boolean; until: number };

const bound = (userId: string) => `cloudflare-oauth:${userId}`;

function cookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/api/storage/cloudflare; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function cookieFor(userId: string, pending: Pending): string {
  const maxAge = Math.max(0, Math.floor((pending.until - Date.now()) / 1000));
  return cookie(encodeURIComponent(seal(JSON.stringify(pending), bound(userId))), maxAge);
}

export const clearedCookie = () => cookie("", 0);

/** What this person's cookie holds, or null when it is missing, expired, or someone else's. */
export function pendingOf(request: Request, userId: string): Pending | null {
  const raw = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  try {
    const pending = JSON.parse(unseal(decodeURIComponent(raw), bound(userId))) as Pending;
    return pending.until > Date.now() ? pending : null;
  } catch (error) {
    if (error instanceof SealError || error instanceof SyntaxError || error instanceof URIError) return null;
    throw error;
  }
}
