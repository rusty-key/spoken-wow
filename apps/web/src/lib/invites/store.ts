/**
 * Invitations to work on a language, for an address that has no account (migration 0109).
 *
 * Only the token's SHA-256 is kept, so a token cannot be handed back after the call that made
 * it; a resend therefore mints a new one. Acts are logged by the routes, which know the actor.
 */
import "server-only";

import type { ClientBase, PoolClient } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { actAs, ALL_TEAMS, db, inTransaction, query } from "@/lib/db";
import { sendInviteEmail } from "@/lib/email";
import { addGrants, refusedGrant, viewerById } from "@/lib/grants/store";
import { isLang, langName, type Lang } from "@/lib/lang";
import { capabilityLabel, isCapability, type Capability } from "@/lib/permissions";
import { hashSecret as hashOf, mintSecret as newToken } from "@/lib/secret-token";
import { SITE } from "@/lib/site";

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
  /** Who accepted it, once it is accepted. */
  acceptedBy: string | null;
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

export function inviteUrl(token: string): string {
  return `${SITE}/api/invites/open?token=${token}`;
}

/** Emails `invite`'s address its link. Never throws, like sendEmail. */
export function emailInvite(invite: InviteRow, token: string): void {
  sendInviteEmail(invite.email, {
    inviterName: invite.invitedByName ?? "A Spoken team member",
    langName: langName(invite.lang),
    capabilities: invite.capabilities.map(capabilityLabel),
    url: inviteUrl(token),
  });
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
      await actAs(client, ALL_TEAMS);
      if (args.limited) {
        // Two requests at once would each count under the limit.
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`invite:${args.invitedBy}`]);
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
      await recordActivity(
        {
          kind: "invite.sent",
          lang: args.lang,
          subject: rows[0].id,
          actorId: args.invitedBy,
          detail: { email: args.email, capabilities: args.capabilities },
        },
        client,
      );
      return { invite: (await openRow(client, rows[0].id))!, token };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new InviteExistsError();
    throw error;
  }
}

export async function resendInvite(id: string, limited: boolean, actorId: string): Promise<{ invite: InviteRow; token: string }> {
  const token = newToken();
  return inTransaction(async (client) => {
    await actAs(client, ALL_TEAMS);
    const { rows } = await client.query<{ lang: string; email: string; sentAt: Date; sendCount: number }>(
      `select "lang", "email", "sentAt", "sendCount" from "invite"
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
    await recordActivity(
      { kind: "invite.resent", lang: rows[0].lang as Lang, subject: id, actorId, detail: { email: rows[0].email } },
      client,
    );
    return { invite: (await openRow(client, id))!, token };
  });
}

export async function revokeInvite(id: string, revokedBy: string): Promise<InviteRow | null> {
  return inTransaction(async (client) => {
    await actAs(client, ALL_TEAMS);
    const invite = await openRow(client, id, true);
    if (!invite) return null;
    await client.query(`update "invite" set "revokedAt" = now(), "revokedBy" = $2 where "id" = $1`, [id, revokedBy]);
    await recordActivity(
      { kind: "invite.revoked", lang: invite.lang as Lang, subject: id, actorId: revokedBy, detail: { email: invite.email } },
      client,
    );
    return invite;
  });
}

/**
 * Revoke the open invite for `email` in `lang`, if any, on the caller's transaction: the address
 * has an account and was just granted directly, so the invite has nothing left to give.
 */
export async function revokeOpenFor(
  client: ClientBase,
  lang: Lang,
  email: string,
  actorId: string,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `update "invite" set "revokedAt" = now(), "revokedBy" = $3
      where "lang" = $1 and "email" = $2 and "acceptedAt" is null and "revokedAt" is null
      returning "id"`,
    [lang, email, actorId],
  );
  for (const { id } of rows) {
    await recordActivity({ kind: "invite.revoked", lang, subject: id, actorId, detail: { email } }, client);
  }
}

export function openInvite(id: string): Promise<InviteRow | null> {
  return openRow(db(), id);
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

type TokenRow = Row & { acceptedAt: Date | null; acceptedBy: string | null; revokedAt: Date | null };

/** Accepted and revoked win over expired: an invite used or withdrawn in time stays so. */
function stateOf(row: TokenRow): InviteLookup["state"] {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  return row.expiresAt.getTime() <= Date.now() ? "expired" : "pending";
}

async function byToken(token: string): Promise<TokenRow | null> {
  const rows = await query<TokenRow>(
    `select ${COLUMNS}, i."acceptedAt", i."acceptedBy", i."revokedAt"
       from "invite" i join "user" u on u."id" = i."invitedBy" where i."tokenHash" = $1`,
    [hashOf(token)],
  );
  return rows[0] ?? null;
}

export async function lookupInvite(token: string): Promise<InviteLookup | null> {
  const row = await byToken(token);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    lang: row.lang,
    capabilities: row.capabilities.filter(isCapability),
    inviterName: row.invitedByName,
    acceptedBy: row.acceptedBy,
    state: stateOf(row),
  };
}

export type AcceptOutcome =
  | { ok: true; lang: string; capabilities: Capability[] }
  | {
      ok: false;
      reason: "unknown" | "expired" | "revoked" | "accepted" | "wrong-email" | "inviter-cannot-grant";
      email?: string;
      inviterName?: string | null;
      capability?: Capability;
    };

class NotClaimed extends Error {}

/**
 * Give `user` what the invite names, as the inviter, once. The inviter is checked again here
 * with `canGrant`, all or none: if they may no longer give every capability, nothing is given
 * and the invite stays pending. The invite is claimed in the same transaction as the grants,
 * so two presses give them once.
 */
export async function acceptInvite(token: string, user: { id: string; email: string }): Promise<AcceptOutcome> {
  const row = await byToken(token);
  if (!row) return { ok: false, reason: "unknown" };
  const invite = toInvite(row);
  const state = stateOf(row);
  if (state !== "pending") return { ok: false, reason: state };
  if (normalEmail(user.email) !== invite.email) return { ok: false, reason: "wrong-email", email: invite.email };

  const { lang, capabilities } = invite;
  const inviterName = invite.invitedByName;
  const viewer = await viewerById(invite.invitedById);
  const refused = isLang(lang) ? await refusedGrant(viewer, capabilities, lang) : capabilities[0];
  if (refused) return { ok: false, reason: "inviter-cannot-grant", inviterName, capability: refused };

  const claim = async (client: ClientBase) => {
    // By token as well, so a resend between the lookup and here kills the old link.
    const { rowCount } = await client.query(
      `update "invite" set "acceptedAt" = now(), "acceptedBy" = $2
        where "id" = $1 and "tokenHash" = $3 and "acceptedAt" is null and "revokedAt" is null and "expiresAt" > now()`,
      [invite.id, user.id, hashOf(token)],
    );
    if (!rowCount) throw new NotClaimed();
    await recordActivity(
      { kind: "invite.accepted", lang: lang as Lang, subject: invite.id, actorId: user.id, detail: { email: invite.email, capabilities } },
      client,
    );
  };
  try {
    await addGrants(user.id, lang, capabilities, invite.invitedById, claim);
  } catch (error) {
    if (!(error instanceof NotClaimed)) throw error;
    // Somebody else's press, a revoke or the clock got there first: say which.
    const now = await byToken(token);
    const state = now && stateOf(now);
    return { ok: false, reason: state && state !== "pending" ? state : "unknown" };
  }
  return { ok: true, lang, capabilities };
}
