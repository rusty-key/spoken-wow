/**
 * Invitations to work on a language, for an address that has no account (migration 0109).
 *
 * Only the token's SHA-256 is kept, so a token cannot be handed back after the call that made
 * it; a resend therefore mints a new one. Acts are logged by the routes, which know the actor.
 */
import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import { inTransaction, query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { isCapability, type Capability } from "@/lib/permissions";

export const INVITE_DAYS = 14;
export const INVITES_PER_DAY = 20;
export const RESEND_GAP_MS = 10 * 60_000;
export const MAX_SENDS = 5;

export type InviteRow = {
  id: string;
  email: string;
  lang: string;
  capabilities: Capability[];
  invitedById: string;
  invitedByName: string | null;
  sentAt: string;
  expiresAt: string;
  expired: boolean;
};

export type InviteLookup = {
  id: string;
  email: string;
  lang: string;
  capabilities: Capability[];
  inviterName: string | null;
  state: "pending" | "expired" | "accepted" | "revoked";
};

export class InviteExistsError extends Error {
  constructor() {
    super("That address is already invited; resend or revoke the invite.");
    this.name = "InviteExistsError";
  }
}

export class InviteGoneError extends Error {
  constructor() {
    super("That invite was accepted or revoked already.");
    this.name = "InviteGoneError";
  }
}

export class InviteRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteRateError";
  }
}

/** The address as stored and compared: trimmed, lower-cased, or null when it is not one. */
export function normalEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

const SITE = (process.env.BETTER_AUTH_URL ?? "https://spoken.quest").replace(/\/$/, "");

export function inviteUrl(token: string): string {
  return `${SITE}/invite?token=${token}`;
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

type Row = {
  id: string;
  email: string;
  lang: string;
  capabilities: string[];
  invitedBy: string;
  invitedByName: string | null;
  sentAt: Date;
  expiresAt: Date;
};

const COLUMNS = `i."id", i."email", i."lang", i."capabilities", i."invitedBy", u."name" as "invitedByName",
                 i."sentAt", i."expiresAt"`;
const OPEN = `i."acceptedAt" is null and i."revokedAt" is null`;

function toInvite(row: Row): InviteRow {
  return {
    id: row.id,
    email: row.email,
    lang: row.lang,
    capabilities: row.capabilities.filter(isCapability),
    invitedById: row.invitedBy,
    invitedByName: row.invitedByName,
    sentAt: row.sentAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= Date.now(),
  };
}

async function openRow(client: Pick<PoolClient, "query">, id: string, lock = false): Promise<InviteRow | null> {
  const { rows } = await client.query<Row>(
    `select ${COLUMNS} from "invite" i join "user" u on u."id" = i."invitedBy"
      where i."id" = $1 and ${OPEN} ${lock ? `for update of i` : ""}`,
    [id],
  );
  return rows[0] ? toInvite(rows[0]) : null;
}

export async function createInvite(args: {
  email: string;
  lang: Lang;
  capabilities: Capability[];
  invitedBy: string;
  limited: boolean;
}): Promise<{ invite: InviteRow; token: string }> {
  const token = newToken();
  try {
    return await inTransaction(async (client) => {
      if (args.limited) {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from "invite" where "invitedBy" = $1 and "createdAt" > now() - interval '24 hours'`,
          [args.invitedBy],
        );
        if (rows[0].n >= INVITES_PER_DAY) {
          throw new InviteRateError(`You can send ${INVITES_PER_DAY} invites a day; try again tomorrow.`);
        }
      }
      await client.query(
        `update "invite" set "revokedAt" = now(), "revokedBy" = $3
          where "lang" = $1 and "email" = $2 and "acceptedAt" is null and "revokedAt" is null
            and "expiresAt" <= now()`,
        [args.lang, args.email, args.invitedBy],
      );
      const { rows } = await client.query<{ id: string }>(
        `insert into "invite" ("email", "lang", "capabilities", "tokenHash", "invitedBy", "expiresAt")
         values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
         returning "id"`,
        [args.email, args.lang, args.capabilities, hashOf(token), args.invitedBy, INVITE_DAYS],
      );
      return { invite: (await openRow(client, rows[0].id))!, token };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new InviteExistsError();
    throw error;
  }
}

export async function resendInvite(id: string, limited: boolean): Promise<{ invite: InviteRow; token: string }> {
  const token = newToken();
  return inTransaction(async (client) => {
    const { rows } = await client.query<{ sentAt: Date; sendCount: number }>(
      `select "sentAt", "sendCount" from "invite"
        where "id" = $1 and "acceptedAt" is null and "revokedAt" is null for update`,
      [id],
    );
    if (!rows[0]) throw new InviteGoneError();
    if (limited) {
      if (rows[0].sendCount >= MAX_SENDS) {
        throw new InviteRateError(`An invite can be sent ${MAX_SENDS} times; revoke it and send a new one.`);
      }
      if (Date.now() - rows[0].sentAt.getTime() < RESEND_GAP_MS) {
        throw new InviteRateError("That invite was sent a moment ago; wait ten minutes before sending it again.");
      }
    }
    await client.query(
      `update "invite" set "tokenHash" = $2, "sentAt" = now(), "sendCount" = "sendCount" + 1,
              "expiresAt" = now() + make_interval(days => $3)
        where "id" = $1`,
      [id, hashOf(token), INVITE_DAYS],
    );
    return { invite: (await openRow(client, id))!, token };
  });
}

export async function revokeInvite(id: string, revokedBy: string): Promise<InviteRow | null> {
  return inTransaction(async (client) => {
    const invite = await openRow(client, id, true);
    if (!invite) return null;
    await client.query(`update "invite" set "revokedAt" = now(), "revokedBy" = $2 where "id" = $1`, [id, revokedBy]);
    return invite;
  });
}

export async function openInvite(id: string): Promise<InviteRow | null> {
  const rows = await query<Row>(
    `select ${COLUMNS} from "invite" i join "user" u on u."id" = i."invitedBy" where i."id" = $1 and ${OPEN}`,
    [id],
  );
  return rows[0] ? toInvite(rows[0]) : null;
}

/** The open invites in `langs` (every language when omitted), newest first. */
export async function listInvites(langs?: string[]): Promise<InviteRow[]> {
  const rows = await query<Row>(
    `select ${COLUMNS} from "invite" i join "user" u on u."id" = i."invitedBy"
      where ${OPEN} and ($1::text[] is null or i."lang" = any($1::text[]))
      order by i."createdAt" desc`,
    [langs ?? null],
  );
  return rows.map(toInvite);
}

export async function lookupInvite(token: string): Promise<InviteLookup | null> {
  const rows = await query<Row & { acceptedAt: Date | null; revokedAt: Date | null }>(
    `select ${COLUMNS}, i."acceptedAt", i."revokedAt"
       from "invite" i join "user" u on u."id" = i."invitedBy" where i."tokenHash" = $1`,
    [hashOf(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    lang: row.lang,
    capabilities: row.capabilities.filter(isCapability),
    inviterName: row.invitedByName,
    state: row.acceptedAt ? "accepted" : row.revokedAt ? "revoked" : row.expiresAt.getTime() <= Date.now() ? "expired" : "pending",
  };
}
