/**
 * Telling voters that a voice they voted on was shown again (migration 0136). A signed-in voter is
 * followed at their account's address; an anonymous one only once they confirm an address. Any
 * address can unsubscribe from every email in one click.
 */
import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { PoolClient } from "pg";

import { ALL_TEAMS, queryIn, withTeam } from "@/lib/db";
import { localeHref, withLang, type Lang } from "@/lib/lang";
import { SITE } from "@/lib/site";

export type FollowState =
  | { kind: "account"; email: string; on: boolean }
  | { kind: "anonymous"; email: string | null; confirmed: boolean };

export type ChangedVoice = { lang: string; slot: string };

const HOUR_MS = 60 * 60 * 1000;

/** Confirmations one IP can have sent in an hour: a person needs one or two, a script would send thousands. */
export const CONFIRMS_PER_IP_HOUR = 5;
const DAY_MS = 24 * HOUR_MS;

const normal = (email: string) => email.trim().toLowerCase();

/** The follow tables belong to no team; ALL_TEAMS reaches the showings they name. */
const system = <T>(work: (client: PoolClient) => Promise<T>) => withTeam(ALL_TEAMS, work);

function signature(email: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET must be set to sign unsubscribe links");
  return createHmac("sha256", secret).update(`voice-follow:${normal(email)}`).digest("base64url");
}

export function unsubscribeUrl(email: string): string {
  const url = new URL(`${SITE}/api/listen/unsubscribe`);
  url.searchParams.set("email", normal(email));
  url.searchParams.set("sig", signature(email));
  return url.toString();
}

export function verifyUnsubscribe(email: string, sig: string): boolean {
  const want = Buffer.from(signature(email));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Drops what was waiting too, so subscribing again later does not send a backlog at once. */
export async function unsubscribe(email: string): Promise<void> {
  await system(async (client) => {
    await client.query(`insert into "voice_follow_optout" ("email") values ($1) on conflict do nothing`, [normal(email)]);
    await client.query(`delete from "voice_follow_notice" where "email" = $1 and "sentAt" is null`, [normal(email)]);
  });
}

export async function followState(voter: string | null, account: { email: string } | null): Promise<FollowState> {
  if (account) {
    const rows = await queryIn(ALL_TEAMS, `select 1 from "voice_follow_optout" where "email" = $1`, [normal(account.email)]);
    return { kind: "account", email: account.email, on: rows.length === 0 };
  }
  if (!voter) return { kind: "anonymous", email: null, confirmed: false };
  const [row] = await queryIn<{ email: string; confirmedAt: Date | null }>(
    ALL_TEAMS,
    `select "email", "confirmedAt" from "voice_follower" where "voter" = $1`,
    [voter],
  );
  return { kind: "anonymous", email: row?.email ?? null, confirmed: Boolean(row?.confirmedAt) };
}

/** The account's toggle on /listen: off is an opt-out of its address, on removes it. */
export async function setAccountFollow(email: string, on: boolean): Promise<void> {
  if (!on) return unsubscribe(email);
  await system((client) => client.query(`delete from "voice_follow_optout" where "email" = $1`, [normal(email)]));
}

/**
 * Keeps the address against the anonymous voter and mails a confirmation link. One confirmation
 * per address an hour, and a few per sender, so the form cannot be used to flood inboxes. Asking
 * again clears an earlier unsubscribe of the address: confirming is asking for the emails.
 */
export async function requestFollow(
  ask: { voter: string; email: string; ip: string; lang: Lang },
  now: Date,
  send: (to: string, url: string) => Promise<boolean>,
): Promise<"sent" | "wait" | "confirmed" | "limited"> {
  const { voter, ip, lang } = ask;
  const email = normal(ask.email);
  const token = randomBytes(24).toString("base64url");
  const outcome = await system(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext('voice_follow:' || $1))`, [email]);
    const { rows } = await client.query<{ email: string; confirmedAt: Date | null }>(
      `select "email", "confirmedAt" from "voice_follower" where "voter" = $1`,
      [voter],
    );
    if (rows[0]?.email === email && rows[0].confirmedAt) return { kind: "confirmed" } as const;
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const fromHere = await client.query<{ n: number }>(
      `select count(*)::int as "n" from "voice_follower" where "confirmIp" = $1 and "confirmSentAt" > $2`,
      [ip, hourAgo],
    );
    if (fromHere.rows[0].n >= CONFIRMS_PER_IP_HOUR) return { kind: "limited" } as const;
    const recent = await client.query(
      `select 1 from "voice_follower" where "email" = $1 and "confirmSentAt" > $2`,
      [email, hourAgo],
    );
    const wait = recent.rows.length > 0;
    // The same address keeps its token, so a link already sent still works after asking again.
    const kept = await client.query<{ confirmToken: string }>(
      `insert into "voice_follower" ("voter", "email", "confirmToken", "confirmSentAt", "confirmIp")
       values ($1, $2, $3, $4, $5)
       on conflict ("voter") do update
         set "confirmToken" = case when "voice_follower"."email" = excluded."email"
                                   then "voice_follower"."confirmToken" else excluded."confirmToken" end,
             "email" = excluded."email", "confirmedAt" = null,
             "confirmSentAt" = coalesce(excluded."confirmSentAt", "voice_follower"."confirmSentAt"),
             "confirmIp" = case when excluded."confirmSentAt" is null then "voice_follower"."confirmIp" else excluded."confirmIp" end
       returning "confirmToken"`,
      [voter, email, token, wait ? null : now, ip],
    );
    return wait ? ({ kind: "wait" } as const) : ({ kind: "sent", token: kept.rows[0].confirmToken } as const);
  });
  if (outcome.kind === "sent") await send(email, `${SITE}${withLang(lang, `/api/listen/confirm?token=${outcome.token}`)}`);
  return outcome.kind;
}

export async function confirmFollow(token: string): Promise<boolean> {
  return system(async (client) => {
    const { rows } = await client.query<{ email: string }>(
      `update "voice_follower" set "confirmedAt" = coalesce("confirmedAt", now()) where "confirmToken" = $1 returning "email"`,
      [token],
    );
    if (!rows[0]) return false;
    await client.query(`delete from "voice_follow_optout" where "email" = $1`, [rows[0].email]);
    return true;
  });
}

export async function stopFollow(voter: string): Promise<void> {
  await system((client) => client.query(`delete from "voice_follower" where "voter" = $1`, [voter]));
}

/**
 * Called in the transaction that shows a version again: everyone who gave a verdict in an earlier
 * showing of the slot, Skip aside, and who can be reached.
 */
export async function queueNotices(client: PoolClient, showingId: number): Promise<void> {
  await client.query(
    `insert into "voice_follow_notice" ("email", "showingId")
     select distinct lower(coalesce(u."email", fl."email")), cur."id"
       from "voice_design_showing" cur
       join "voice_design_showing" s
         on s."teamId" = cur."teamId" and s."lang" = cur."lang" and s."slot" = cur."slot" and s."id" < cur."id"
       join "voice_feedback" f on f."showingId" = s."id" and f."verdict" <> 'skip'
       left join "user" u on u."id" = f."userId"
       left join "voice_follower" fl on fl."voter" = f."voter" and fl."confirmedAt" is not null
      where cur."id" = $1
        and coalesce(u."email", fl."email") is not null
        and lower(coalesce(u."email", fl."email")) not in (select "email" from "voice_follow_optout")
     on conflict do nothing`,
    [showingId],
  );
}

/**
 * One email per address with notices waiting, at most once a day: a maintainer showing five
 * voices in an afternoon sends one email, not five. Returns how many were sent.
 */
export async function sendDue(now: Date, send: (to: string, voices: ChangedVoice[]) => Promise<boolean>): Promise<number> {
  const rows = await queryIn<{ email: string; lang: string; slot: string; showingId: string }>(
    ALL_TEAMS,
    `select n."email", s."lang", s."slot", n."showingId"
       from "voice_follow_notice" n join "voice_design_showing" s on s."id" = n."showingId"
      where n."sentAt" is null
        and n."email" not in (select "email" from "voice_follow_optout")
        and not exists (select 1 from "voice_follow_notice" p where p."email" = n."email" and p."sentAt" > $1)
      order by n."email", s."lang", s."slot"`,
    [new Date(now.getTime() - DAY_MS)],
  );
  const byEmail = new Map<string, { voices: ChangedVoice[]; showings: number[] }>();
  for (const row of rows) {
    const entry = byEmail.get(row.email) ?? { voices: [], showings: [] };
    if (!entry.voices.some((v) => v.lang === row.lang && v.slot === row.slot)) entry.voices.push({ lang: row.lang, slot: row.slot });
    entry.showings.push(Number(row.showingId));
    byEmail.set(row.email, entry);
  }
  let sent = 0;
  for (const [email, { voices, showings }] of byEmail) {
    // Not marked when the provider refuses, so the next round tries again.
    if (!(await send(email, voices))) continue;
    await system((client) =>
      client.query(`update "voice_follow_notice" set "sentAt" = $3 where "email" = $1 and "showingId" = any($2::bigint[])`, [
        email,
        showings,
        now,
      ]),
    );
    sent += 1;
  }
  return sent;
}

export const listenUrl = (lang: Lang) => `${SITE}${localeHref(lang, "/listen")}`;
