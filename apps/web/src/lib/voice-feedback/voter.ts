/**
 * Who is voting on /listen: the account when signed in, else a random id kept in a cookie. The
 * cookie is the whole protection against counting one person twice, and nothing keyed on the
 * address can lock a real player out.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { isUuid } from "@/lib/uuid";

export const VOTER_COOKIE = "spoken_voter";

const TWO_YEARS_S = 2 * 365 * 24 * 60 * 60;

/** The voter this request votes as; null for an anonymous visitor with no cookie yet. */
export async function currentVoter(userId: string | null): Promise<string | null> {
  if (userId) return `u:${userId}`;
  const id = (await cookies()).get(VOTER_COOKIE)?.value;
  return id && isUuid(id) ? `a:${id}` : null;
}

/** As currentVoter, minting the cookie on a first anonymous vote. Route handlers only. */
export async function voterFor(userId: string | null): Promise<string> {
  const known = await currentVoter(userId);
  if (known) return known;
  const id = randomUUID();
  (await cookies()).set(VOTER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TWO_YEARS_S,
  });
  return `a:${id}`;
}
