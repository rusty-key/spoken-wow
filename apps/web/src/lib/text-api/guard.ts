/**
 * The access boundary for /api/v1, which has a token where the site's routes have a session.
 *
 * The grant is asked for on every request rather than when the token was made, so taking `text`
 * away from somebody kills their tokens at once instead of at their expiry.
 */
import "server-only";

import { viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { can, type Capability } from "@/lib/permissions";
import { findLiveToken } from "@/lib/tokens/store";
import type { TokenAccess } from "@/lib/tokens/types";

export type TokenContext = {
  tokenId: string;
  userId: string;
  role: string | null;
  lang: Lang;
  access: TokenAccess;
};

const BEARER = /^Bearer\s+(\S+)$/;

/** `also` is a grant a route needs on top of `text`: lexicon writes need `configure`, as on the site. */
export async function requireToken(
  request: Request,
  options: { write?: boolean; also?: Capability } = {},
): Promise<{ context: TokenContext; denied: null } | { context: null; denied: Response }> {
  const denied = (status: number, error: string) => ({
    context: null,
    denied: Response.json({ error }, { status }),
  });

  const raw = request.headers.get("authorization")?.match(BEARER)?.[1];
  const token = raw ? await findLiveToken(raw) : null;
  if (!token) return denied(401, "a valid API token is required");

  const viewer = await viewerOf({ user: { id: token.userId, role: token.role } });
  if (!can(viewer, "text", token.lang)) {
    return denied(403, `this token's owner is not a text maintainer in ${token.lang}`);
  }
  if (options.write && token.access !== "write") return denied(403, "this token is read-only");
  if (options.also && !can(viewer, options.also, token.lang)) {
    return denied(403, `this token's owner does not hold ${options.also} in ${token.lang}`);
  }

  return {
    context: {
      tokenId: token.id,
      userId: token.userId,
      role: token.role,
      lang: token.lang,
      access: token.access,
    },
    denied: null,
  };
}
