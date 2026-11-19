/**
 * The Cloudflare grant waiting in the admin's cookie (docs/platform/STORAGE.md, "Connecting
 * Cloudflare"). GET lists the accounts it reaches and whether the grant can make the bucket's key.
 * POST makes the bucket; with a key, pasted or made, it saves and tests it and revokes the grant,
 * and without one it answers `needsKey`. A pasted key needs no grant: it may lapse while the admin
 * makes the key. DELETE revokes the grant unused.
 */
import { after } from "next/server";

import { StorageError } from "@/lib/storage/backends";
import {
  accountsOf,
  clearedCookie,
  connectCloudflare,
  pendingOf,
  revoke,
  suggestedBucket,
} from "@/lib/storage/cloudflare";

import { jsonBody, withTeamAdmin, type StorageContext } from "../guard";

export const dynamic = "force-dynamic";

/** This language's waiting grant, or null. */
function waiting(request: Request, { lang, userId }: StorageContext): { token: string; mintsKeys: boolean } | null {
  const pending = pendingOf(request, userId);
  return pending?.step === "connected" && pending.lang === lang ? pending : null;
}

function grant(request: Request, at: StorageContext): { token: string; mintsKeys: boolean } {
  const found = waiting(request, at);
  if (!found) throw new StorageError("No Cloudflare grant is waiting, or it lapsed: connect Cloudflare again.", 409);
  return found;
}

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const GET = withTeamAdmin(async (request, at) => {
  const { token, mintsKeys } = grant(request, at);
  return Response.json({ accounts: await accountsOf(token), bucket: suggestedBucket(at.lang), mintsKeys });
});

export const POST = withTeamAdmin(async (request, at) => {
  const found = waiting(request, at);
  const body = await jsonBody(request);
  const accountId = trimmed(body.accountId);
  const bucket = trimmed(body.bucket);
  const label = trimmed(body.label).slice(0, 80) || bucket;
  const accessKeyId = trimmed(body.accessKeyId);
  const secretAccessKey = trimmed(body.secretAccessKey);
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new StorageError("Paste both the access key id and the secret access key.");
  const key = accessKeyId ? { accessKeyId, secretAccessKey } : null;
  // A refusal, or a bucket waiting for its key, keeps the grant: the admin carries on without going back to Cloudflare.
  const done = await connectCloudflare(at.team, at.userId, found?.token ?? null, { accountId, bucket, label, key }, { mintsKeys: found?.mintsKeys ?? false });
  if ("needsKey" in done) return Response.json(done);
  if (!found) return Response.json(done, { status: 201 });
  after(() => revoke(found.token));
  return Response.json(done, { status: 201, headers: { "Set-Cookie": clearedCookie() } });
});

/** Only this language's grant: one for another language the admin is setting up is left alone. */
export const DELETE = withTeamAdmin(async (request, { lang, userId }) => {
  const pending = pendingOf(request, userId);
  if (pending && pending.lang !== lang) return new Response(null, { status: 204 });
  if (pending?.step === "connected") after(() => revoke(pending.token));
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedCookie() } });
});
