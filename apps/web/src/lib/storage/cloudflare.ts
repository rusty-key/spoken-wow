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
import { SITE } from "@/lib/site";
import type { TeamId } from "@/lib/teams/store";

import { backendInput, backendView, createBackend, testBackend, type BackendView } from "./backends";
import type { ProbeResult } from "./probe";

const AUTHORIZE = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN = "https://dash.cloudflare.com/oauth2/token";
const REVOKE = "https://dash.cloudflare.com/oauth2/revoke";
const API = "https://api.cloudflare.com/client/v4";

/** The permission group a bucket's key gets: read, write and list objects in that one bucket. */
const OBJECT_WRITE = "Workers R2 Storage Bucket Item Write";

export const CALLBACK_PATH = "/api/storage/cloudflare/callback";

/** A refusal from Cloudflare, or a step of the setup that could not go on; its message is fit to show. */
export class CloudflareError extends Error {
  constructor(message: string) {
    super(message);
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
  if (!found) throw new CloudflareError("Connecting Cloudflare is not set up on this site.");
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

const basic = ({ clientId, clientSecret }: Config) =>
  `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;

/** The access token the code is worth, and how many seconds it lasts. */
export async function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: Fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const conf = required();
  const res = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { authorization: basic(conf), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown } | null;
  if (!res.ok || typeof body?.access_token !== "string") {
    const why = typeof body?.error_description === "string" ? body.error_description : typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new CloudflareError(`Cloudflare did not hand over access: ${why}`);
  }
  return { accessToken: body.access_token, expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600 };
}

/** Best effort: a token that outlives the setup lapses on its own within the hour. */
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
    .then((res) => res.body?.cancel())
    .catch(() => {});
}

type Envelope<T> = { success?: boolean; result?: T; errors?: { code?: number; message?: string }[] };

/** One call to Cloudflare's API; a refusal throws naming `doing`. Null on a 404 when `missingOk`. */
async function api<T>(
  token: string,
  doing: string,
  path: string,
  { method = "GET", body, missingOk = false, fetchImpl = fetch }: { method?: string; body?: unknown; missingOk?: boolean; fetchImpl?: Fetch } = {},
): Promise<T | null> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
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

export async function accountsOf(token: string, fetchImpl: Fetch = fetch): Promise<CloudflareAccount[]> {
  const rows = (await api<{ id: string; name: string }[]>(token, "list your accounts", "/accounts?per_page=50", { fetchImpl })) ?? [];
  return rows.map(({ id, name }) => ({ id, name }));
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** R2's own rule for a bucket's name. */
const R2_BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** What the bucket is called unless the admin says otherwise. */
export const suggestedBucket = (lang: Lang): string => `spoken-${lang.toLowerCase()}`.replace(/[^a-z0-9-]/g, "-");

export type MadeBucket = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; created: boolean };

/**
 * The bucket, created unless the account has one by that name, and a new key for it alone. An R2
 * key is an API token: its id is the access key id and the SHA-256 of its value the secret.
 */
export async function makeBucket(
  token: string,
  { accountId, bucket, keyName }: { accountId: string; bucket: string; keyName: string },
  fetchImpl: Fetch = fetch,
): Promise<MadeBucket> {
  if (!ACCOUNT_ID.test(accountId)) throw new CloudflareError("That is not a Cloudflare account id.");
  if (!R2_BUCKET.test(bucket)) throw new CloudflareError("The bucket's name is 3 to 63 lowercase letters, digits and dashes, starting and ending with a letter or digit.");
  const account = `/accounts/${accountId}`;
  const found = await api(token, "look for the bucket", `${account}/r2/buckets/${bucket}`, { missingOk: true, fetchImpl });
  if (!found) await api(token, "create the bucket", `${account}/r2/buckets`, { method: "POST", body: { name: bucket }, fetchImpl });

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
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId: minted.id,
    secretAccessKey: createHash("sha256").update(minted.value).digest("hex"),
    created: !found,
  };
}

/**
 * Makes the bucket and its key, saves it as the team's, and tests it. A new key can take a few
 * seconds to reach R2, so a failing test is tried again a few times before it stands.
 */
export async function connectCloudflare(
  team: TeamId,
  userId: string,
  token: string,
  { accountId, bucket, label }: { accountId: string; bucket: string; label: string },
  { fetchImpl = fetch, tries = 5, pauseMs = 3_000 }: { fetchImpl?: Fetch; tries?: number; pauseMs?: number } = {},
): Promise<{ backend: BackendView; test: ProbeResult | null }> {
  const made = await makeBucket(token, { accountId, bucket, keyName: `Spoken: ${label}` }, fetchImpl);
  const backend = await createBackend(
    team,
    backendInput({
      provider: "r2", label, endpoint: made.endpoint, region: "auto", bucket: made.bucket, pathStyle: true,
      accessKeyId: made.accessKeyId, secretAccessKey: made.secretAccessKey,
    }),
    userId,
  );
  let test: ProbeResult | null = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    test = await testBackend(team, backend.id);
    if (!test || test.ok || attempt === tries) break;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return { backend: await backendView(team, backend.id), test };
}

/*
 * The cookie between the steps, sealed and bound to the person: first the state and PKCE verifier
 * while they are at Cloudflare, then the access token until the bucket is made. Path-scoped to these
 * routes, httpOnly, and gone within minutes.
 */

export const COOKIE = "spoken_cloudflare";

export type Pending =
  | { step: "authorize"; lang: Lang; state: string; verifier: string; until: number }
  | { step: "connected"; lang: Lang; token: string; until: number };

const bound = (userId: string) => `cloudflare-oauth:${userId}`;

export function cookieFor(userId: string, pending: Pending): string {
  const maxAge = Math.max(0, Math.floor((pending.until - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = seal(JSON.stringify(pending), bound(userId));
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/api/storage/cloudflare; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export const clearedCookie = () => `${COOKIE}=; Path=/api/storage/cloudflare; Max-Age=0; HttpOnly; SameSite=Lax`;

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
