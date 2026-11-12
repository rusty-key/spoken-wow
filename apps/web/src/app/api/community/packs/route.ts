/** The Spoken Manager's registry of approved community packs. Public: no sign-in, no cookies. */
import { createHash } from "node:crypto";

import { managerEntries } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const body = JSON.stringify({ packs: await managerEntries() });
  // A hash of the body, so a Manager that asks again with it gets a 304 and no download.
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
  const headers = { ETag: etag, "Cache-Control": "public, max-age=300" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
}
