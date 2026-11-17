/**
 * The access boundary for /api/v1, which has a token where the site's routes have a session.
 *
 * The grant is asked for on every request rather than when the token was made, so taking `text`
 * (or `regenerate`, for a generate token) away from somebody kills their tokens at once instead
 * of at their expiry.
 */
import "server-only";

import { viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { can, type Capability, type Viewer } from "@/lib/permissions";
import { findLiveToken } from "@/lib/tokens/store";
import type { TokenAccess } from "@/lib/tokens/types";

export type TokenContext = {
  tokenId: string;
  userId: string;
  role: string | null;
  lang: Lang;
  access: TokenAccess;
  generate: boolean;
};

const BEARER = /^Bearer\s+(\S+)$/;

export type TokenNeed = "read" | "write" | "generate" | "any";

/**
 * Which of a token's scopes its owner's grants back: text access needs `text`, generate needs
 * `regenerate`. A scope the token does not carry is false.
 */
export function backedScopes(
  viewer: Viewer | null,
  lang: Lang,
  access: TokenAccess,
  generate: boolean,
): { text: boolean; generate: boolean } {
  return {
    text: access !== "none" && can(viewer, "text", lang),
    generate: generate && can(viewer, "regenerate", lang),
  };
}

/**
 * `need` is the scope the route works under: `read` and `write` need text access, `generate`
 * needs the generate flag, `any` takes either. Each is checked against the owner's grant now.
 * `also` is a grant a route needs on top: lexicon writes need `configure`, as on the site.
 * `noQuery` refuses a query string with a 400, worded as given or a default.
 */
export async function requireToken(
  request: Request,
  options: { need?: TokenNeed; also?: Capability; noQuery?: true | string } = {},
): Promise<{ context: TokenContext; denied: null } | { context: null; denied: Response }> {
  const need = options.need ?? "read";
  const denied = (status: number, error: string) => ({
    context: null,
    denied: Response.json({ error }, { status }),
  });

  const raw = request.headers.get("authorization")?.match(BEARER)?.[1];
  const token = raw ? await findLiveToken(raw) : null;
  if (!token) return denied(401, "a valid API token is required");

  const viewer = await viewerOf({ user: { id: token.userId, role: token.role } });
  const hasText = token.access !== "none";
  const { text: textOk, generate: generateOk } = backedScopes(viewer, token.lang, token.access, token.generate);

  const noText = () =>
    hasText
      ? denied(403, `this token's owner is not a text maintainer in ${token.lang}`)
      : denied(403, "this token has no text access");
  const noGenerate = () =>
    token.generate
      ? denied(403, `this token's owner does not hold regenerate in ${token.lang}`)
      : denied(403, "this token cannot generate");

  if (need === "generate") {
    if (!generateOk) return noGenerate();
  } else if (need === "any") {
    if (!textOk && !generateOk) return hasText ? noText() : noGenerate();
  } else {
    if (!textOk) return noText();
    if (need === "write" && token.access !== "write") return denied(403, "this token is read-only");
  }
  if (options.also && !can(viewer, options.also, token.lang)) {
    return denied(403, `this token's owner does not hold ${options.also} in ${token.lang}`);
  }
  if (options.noQuery && new URL(request.url).search) {
    return denied(400, options.noQuery === true ? "this takes no query string" : options.noQuery);
  }

  return {
    context: {
      tokenId: token.id,
      userId: token.userId,
      role: token.role,
      lang: token.lang,
      // What the grants back, not what the token stores: `any` lets one scope through alone.
      access: textOk ? token.access : "none",
      generate: generateOk,
    },
    denied: null,
  };
}
