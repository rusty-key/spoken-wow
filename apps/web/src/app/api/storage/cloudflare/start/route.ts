/** Sends a team admin to Cloudflare to grant access, keeping the state and PKCE verifier in a sealed cookie. */
import { authorization, cloudflareReady, cookieFor } from "@/lib/storage/cloudflare";
import { StorageError } from "@/lib/storage/backends";

import { withTeamAdmin } from "../../guard";

export const dynamic = "force-dynamic";

/** Long enough to sign in to Cloudflare and pick an account. */
const AUTHORIZE_MS = 10 * 60_000;

export const GET = withTeamAdmin(async (_request, { lang, userId }) => {
  if (!cloudflareReady()) throw new StorageError("Connecting Cloudflare is not set up on this site.", 404);
  const { url, state, verifier } = authorization();
  const headers = new Headers({ Location: url });
  headers.append("Set-Cookie", cookieFor(userId, { step: "authorize", lang, state, verifier, until: Date.now() + AUTHORIZE_MS }));
  return new Response(null, { status: 303, headers });
});
