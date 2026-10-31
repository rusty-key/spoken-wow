/**
 * A Manager token reaches only the worker routes, names one install, and is revoked on /profile
 * without signing the author out; only its hash is stored. Between approval and the Manager's
 * one collection (polling with a secret only it holds), the token waits sealed under
 * SPOKEN_SECRET_KEY.
 */
import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { db, inTransaction } from "@/lib/db";
import { open, seal, type Sealed } from "@/lib/secrets";
import { currentSession } from "@/lib/session";

const PAIRING_TTL_MINUTES = 10;
/** No 0/O or 1/I: the code is read off one screen and typed into another. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

function code(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Start a pairing: the code to show, and the secret the Manager polls with. */
export async function startPairing(label: string): Promise<{ code: string; poll: string; expiresAt: Date }> {
  const poll = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000);
  const pairing = code();
  await db().query(`delete from "worker_pairing" where "expiresAt" < now()`);
  await db().query(
    `insert into "worker_pairing" ("code", "pollHash", "label", "expiresAt") values ($1, $2, $3, $4)`,
    [pairing, hash(poll), label.slice(0, 80) || "Spoken Manager", expiresAt],
  );
  return { code: pairing, poll, expiresAt };
}

export function normaliseCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

/** What the author is asked to approve, or null for a code that is unknown or expired. */
export async function pendingPairing(input: string): Promise<{ code: string; label: string } | null> {
  const { rows } = await db().query<{ code: string; label: string }>(
    `select "code", "label" from "worker_pairing"
      where "code" = $1 and "expiresAt" > now() and "userId" is null`,
    [normaliseCode(input)],
  );
  return rows[0] ?? null;
}

/** Approve a pairing as `userId`: mint the token and leave it sealed for the Manager. */
export async function approvePairing(input: string, userId: string): Promise<boolean> {
  const pairing = await pendingPairing(input);
  if (!pairing) return false;
  const token = `spw_${randomBytes(32).toString("base64url")}`;
  return inTransaction(async (client) => {
    const { rowCount } = await client.query(
      `update "worker_pairing" set "userId" = $2, "sealedToken" = $3
        where "code" = $1 and "userId" is null and "expiresAt" > now()`,
      [pairing.code, userId, JSON.stringify(seal(token))],
    );
    if (!rowCount) return false;
    await client.query(
      `insert into "worker_token" ("id", "userId", "tokenHash", "label") values ($1, $2, $3, $4)`,
      [randomUUID(), userId, hash(token), pairing.label],
    );
    return true;
  });
}

export type PollResult = { status: "pending" } | { status: "expired" } | { status: "approved"; token: string };

/** The Manager's poll. Hands the token over once, and forgets it. */
export async function pollPairing(poll: string): Promise<PollResult> {
  const { rows } = await db().query<{ sealedToken: string | null }>(
    `delete from "worker_pairing" where "pollHash" = $1 and "sealedToken" is not null returning "sealedToken"`,
    [hash(poll)],
  );
  if (rows[0]?.sealedToken) return { status: "approved", token: open(JSON.parse(rows[0].sealedToken) as Sealed) };
  const { rows: waiting } = await db().query(
    `select 1 from "worker_pairing" where "pollHash" = $1 and "expiresAt" > now()`,
    [hash(poll)],
  );
  return waiting.length > 0 ? { status: "pending" } : { status: "expired" };
}

/**
 * A tab gets in on its session cookie only when sending JSON from this site's origin: a form on
 * another site cannot send JSON without a preflight these routes never answer.
 */
export async function workerUser(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header) return tabUser(request);
  const token = bearerToken(header);
  if (!token) return null;
  // lastUsedAt only backs /profile's "last seen", so it is written every five minutes at most.
  const { rows } = await db().query<{ userId: string }>(
    `with found as (
       select "id", "userId", "lastUsedAt" from "worker_token"
        where "tokenHash" = $1 and "revokedAt" is null
     ), touched as (
       update "worker_token" t set "lastUsedAt" = now() from found
        where t."id" = found."id"
          and (found."lastUsedAt" is null or found."lastUsedAt" < now() - interval '5 minutes')
     )
     select "userId" from found`,
    [hash(token)],
  );
  return rows[0]?.userId ?? null;
}

function bearerToken(header: string): string | null {
  return /^Bearer\s+(spw_[A-Za-z0-9_-]{20,})$/.exec(header.trim())?.[1] ?? null;
}

/** A Manager unpairing itself. False for a tab, which has no token, or a token already revoked. */
export async function revokeCallingToken(request: Request): Promise<boolean> {
  const token = bearerToken(request.headers.get("authorization") ?? "");
  if (!token) return false;
  const { rowCount } = await db().query(
    `update "worker_token" set "revokedAt" = now() where "tokenHash" = $1 and "revokedAt" is null`,
    [hash(token)],
  );
  return (rowCount ?? 0) > 0;
}

export type WorkerToken = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

export async function listTokens(userId: string): Promise<WorkerToken[]> {
  const { rows } = await db().query<{ id: string; label: string; createdAt: Date; lastUsedAt: Date | null }>(
    `select "id", "label", "createdAt", "lastUsedAt" from "worker_token"
      where "userId" = $1 and "revokedAt" is null order by "createdAt"`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await db().query(
    `update "worker_token" set "revokedAt" = now() where "id" = $1 and "userId" = $2 and "revokedAt" is null`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

async function tabUser(request: Request): Promise<string | null> {
  const origin = request.headers.get("origin");
  const ours = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).origin : new URL(request.url).origin;
  if (request.method !== "GET") {
    if (origin !== ours) return null;
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return null;
  }
  const session = await currentSession();
  return session?.user.id ?? null;
}
