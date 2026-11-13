/**
 * The signed-in maintainer's own API tokens. A token's value leaves the server once, in the
 * response that creates it, and nothing can read it back afterwards.
 */
import { viewerOf } from "@/lib/grants/store";
import { isLang } from "@/lib/lang";
import { can } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { createToken, isTokenAccess, listTokens } from "@/lib/tokens/store";

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
    label?: unknown;
    expiresAt?: unknown;
  };
  if (!isLang(body.lang)) return invalid("lang must be a language");
  if (!isTokenAccess(body.access)) return invalid("access must be none, read or write");
  if (body.generate !== undefined && typeof body.generate !== "boolean") return invalid("generate must be true or false");
  const generate = body.generate === true;
  if (body.access === "none" && !generate) return invalid("a token must read, write or generate");

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > MAX_LABEL) return invalid(`label is required, at most ${MAX_LABEL} characters`);

  const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null;
  if (!expiresAt || !(expiresAt.getTime() > Date.now())) return invalid("expiresAt must be a date in the future");

  const viewer = await viewerOf(session);
  if (body.access !== "none" && !can(viewer, "text", body.lang)) return FORBIDDEN();
  if (generate && !can(viewer, "regenerate", body.lang)) return FORBIDDEN();

  return Response.json(
    await createToken({ userId: session.user.id, lang: body.lang, access: body.access, generate, label, expiresAt }),
  );
}
