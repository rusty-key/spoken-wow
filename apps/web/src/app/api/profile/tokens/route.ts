/**
 * The signed-in member's own API tokens. A token's value leaves the server once, in the
 * response that creates it, and nothing can read it back afterwards.
 */
import { viewerOf } from "@/lib/grants/store";
import { knownLang } from "@/lib/languages/catalogue";
import { currentSession } from "@/lib/session";
import { backedScopes } from "@/lib/text-api/guard";
import { createToken, isTokenAccess, listTokens } from "@/lib/tokens/store";
import { needsLang } from "@/lib/tokens/types";

export const dynamic = "force-dynamic";

const MAX_LABEL = 100;

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });
const invalid = (error: string) => Response.json({ error }, { status: 400 });

export async function GET() {
  const session = await currentSession();
  if (!session) return FORBIDDEN();
  return Response.json({ tokens: await listTokens(session.user.id) });
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return FORBIDDEN();

  const body = (await request.json().catch(() => ({}))) as {
    lang?: unknown;
    access?: unknown;
    generate?: unknown;
    packs?: unknown;
    label?: unknown;
    expiresAt?: unknown;
  };
  if (!isTokenAccess(body.access)) return invalid("access must be none, read or write");
  if (body.generate !== undefined && typeof body.generate !== "boolean") return invalid("generate must be true or false");
  if (body.packs !== undefined && typeof body.packs !== "boolean") return invalid("packs must be true or false");
  const generate = body.generate === true;
  const packs = body.packs === true;
  if (body.access === "none" && !generate && !packs) return invalid("a token must read, write, generate or submit packs");
  const langed = needsLang({ access: body.access, generate });
  const lang = langed ? await knownLang(body.lang) : null;
  if (langed && !lang) return invalid("lang must be a language");

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > MAX_LABEL) return invalid(`label is required, at most ${MAX_LABEL} characters`);

  const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null;
  if (!expiresAt || !(expiresAt.getTime() > Date.now())) return invalid("expiresAt must be a date in the future");

  if (lang) {
    const viewer = await viewerOf(session);
    const backed = backedScopes(viewer, lang, body.access, generate);
    if (backed.text !== (body.access !== "none") || backed.generate !== generate) return FORBIDDEN();
  }

  return Response.json(
    await createToken({ userId: session.user.id, lang, access: body.access, generate, packs, label, expiresAt }),
  );
}
