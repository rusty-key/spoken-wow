/**
 * The Cloudflare grant waiting in the admin's cookie (docs/platform/STORAGE.md, "Connecting
 * Cloudflare"). GET lists the accounts it reaches; POST makes the bucket and its key, saves and
 * tests it, then revokes the grant; DELETE revokes it unused.
 */
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

function grant(request: Request, { lang, userId }: StorageContext): string {
  const pending = pendingOf(request, userId);
  if (pending?.step !== "connected" || pending.lang !== lang) {
    throw new StorageError("No Cloudflare grant is waiting, or it lapsed: connect Cloudflare again.", 409);
  }
  return pending.token;
}

export const GET = withTeamAdmin(async (request, at) => {
  const accounts = await accountsOf(grant(request, at));
  return Response.json({ accounts, bucket: suggestedBucket(at.lang) });
});

export const POST = withTeamAdmin(async (request, at) => {
  const token = grant(request, at);
  const body = await jsonBody(request);
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const bucket = typeof body.bucket === "string" ? body.bucket.trim() : "";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : bucket;
  // A refusal keeps the grant, so the admin can pick another name or account without going back to Cloudflare.
  const { backend, test } = await connectCloudflare(at.team, at.userId, token, { accountId, bucket, label });
  await revoke(token);
  return Response.json({ backend, test }, { status: 201, headers: { "Set-Cookie": clearedCookie() } });
});

export const DELETE = withTeamAdmin(async (request, { userId }) => {
  const pending = pendingOf(request, userId);
  if (pending?.step === "connected") await revoke(pending.token);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedCookie() } });
});
