/**
 * Only a hash is kept, so nothing here can hand a token back after the response that created
 * it. The hash is a plain SHA-256 because a token is 32 random bytes, which leaves nothing for
 * a slow hash to protect, and it is looked up on every API request.
 */
import "server-only";

import { query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { hashSecret as hashOf, mintSecret } from "@/lib/secret-token";

import type { ApiToken, TokenAccess } from "./types";

export function isTokenAccess(value: unknown): value is TokenAccess {
  return value === "none" || value === "read" || value === "write";
}

type Row = Omit<ApiToken, "createdAt" | "expiresAt" | "lastUsedAt" | "revokedAt"> & {
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

const COLUMNS = `t."id", t."userId", t."lang", t."access", t."generate", t."label", t."hint",
                 t."createdAt", t."expiresAt", t."lastUsedAt", t."revokedAt"`;

function toToken({ createdAt, expiresAt, lastUsedAt, revokedAt, ...rest }: Row): ApiToken {
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastUsedAt: lastUsedAt?.toISOString() ?? null,
    revokedAt: revokedAt?.toISOString() ?? null,
  };
}

export async function createToken(args: {
  userId: string;
  lang: Lang;
  access: TokenAccess;
  generate: boolean;
  label: string;
  expiresAt: Date;
}): Promise<{ token: string; row: ApiToken }> {
  if (!(args.expiresAt.getTime() > Date.now())) throw new Error("the expiry must be in the future");

  const token = `spk_${mintSecret()}`;
  const rows = await query<Row>(
    `insert into "api_token" as t ("userId", "lang", "access", "generate", "label", "tokenHash", "hint", "expiresAt")
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${COLUMNS}`,
    [args.userId, args.lang, args.access, args.generate, args.label, hashOf(token), token.slice(-4), args.expiresAt],
  );
  return { token, row: toToken(rows[0]) };
}

/**
 * The token and its owner's role, or null if it is unknown, expired, revoked or its owner is
 * banned. A ban with a past banExpires has lapsed, as it has for a session.
 *
 * The write is limited to once a minute so that an agent's requests do not each update the row
 * or wait on it. The condition in the update is for the other worker, which may have just written.
 */
export async function findLiveToken(raw: string): Promise<(ApiToken & { role: string | null }) | null> {
  const rows = await query<Row & { role: string | null }>(
    `select ${COLUMNS}, u."role"
       from "api_token" t join "user" u on u."id" = t."userId"
      where t."tokenHash" = $1 and t."revokedAt" is null and t."expiresAt" > now()
        and not (coalesce(u."banned", false) and (u."banExpires" is null or u."banExpires" > now()))`,
    [hashOf(raw)],
  );
  if (!rows[0]) return null;
  const lastUsed = rows[0].lastUsedAt;
  if (!lastUsed || Date.now() - lastUsed.getTime() >= 60_000) {
    await query(
      `update "api_token" set "lastUsedAt" = now()
        where "id" = $1 and ("lastUsedAt" is null or "lastUsedAt" < now() - interval '1 minute')`,
      [rows[0].id],
    );
  }
  const { role, ...row } = rows[0];
  return { ...toToken(row), role };
}

export async function listTokens(userId: string): Promise<ApiToken[]> {
  const rows = await query<Row>(
    `select ${COLUMNS} from "api_token" t where t."userId" = $1 order by t."createdAt" desc`,
    [userId],
  );
  return rows.map(toToken);
}

export async function listAllTokens(): Promise<(ApiToken & { userEmail: string })[]> {
  const rows = await query<Row & { userEmail: string }>(
    `select ${COLUMNS}, u."email" as "userEmail"
       from "api_token" t join "user" u on u."id" = t."userId"
      order by t."createdAt" desc`,
  );
  return rows.map(({ userEmail, ...row }) => ({ ...toToken(row), userEmail }));
}

/** `ownerId` limits it to that person's token; null is an admin's, for anyone's. */
export async function revokeToken(id: string, ownerId: string | null): Promise<boolean> {
  const rows = await query(
    `update "api_token" set "revokedAt" = now()
      where "id" = $1 and "revokedAt" is null and ($2::text is null or "userId" = $2)
      returning "id"`,
    [id, ownerId],
  );
  return rows.length > 0;
}
