/**
 * Who may do what in which language.
 *
 * A global admin sees and changes every grant. Somebody who is `admin` in a language sees
 * that language's and may hand out its team capabilities, and `text` when its team appoints it
 * (`textByTeam`).
 * lib/permissions.ts `canGrant` is the rule; this only applies it.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { addGrants, listGrants, refusedGrant, removeGrant, userByEmail, viewerOf } from "@/lib/grants/store";
import { isLang } from "@/lib/lang";
import { isAdmin, isCapability, langsWhere, removesOwnAdmin, type Viewer } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

async function viewer(): Promise<{ viewer: Viewer; userId: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const seen = await viewerOf(session);
  return session && seen ? { viewer: seen, userId: session.user.id } : null;
}

/** What `viewer` may see: every grant for an admin, their own languages' for a language admin. */
async function listing(viewer: Viewer): Promise<Response> {
  const langs = langsWhere(viewer, "admin");
  if (langs.length === 0) return FORBIDDEN();
  return Response.json({ grants: await listGrants(isAdmin(viewer.role) ? undefined : langs) });
}

export async function GET() {
  const who = await viewer();
  return who ? listing(who.viewer) : FORBIDDEN();
}

export async function PUT(request: Request) {
  const who = await viewer();
  if (!who) return FORBIDDEN();

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    lang?: unknown;
    capabilities?: unknown;
  };
  const { email, lang, capabilities } = body;
  if (
    typeof email !== "string" ||
    !isLang(lang) ||
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    !capabilities.every(isCapability)
  ) {
    return Response.json({ error: "expected { email, lang, capabilities: [...] }" }, { status: 400 });
  }
  if (await refusedGrant(who.viewer, capabilities, lang)) return FORBIDDEN();

  // By email, not by id: a language admin cannot list the users, and an address is what
  // a translator gives somebody when asking to be let in.
  const user = await userByEmail(email);
  if (!user) return Response.json({ error: `nobody has registered as ${email}` }, { status: 404 });

  await addGrants(user.id, lang, capabilities, who.userId);
  return listing(who.viewer);
}

export async function DELETE(request: Request) {
  const who = await viewer();
  if (!who) return FORBIDDEN();

  const params = new URL(request.url).searchParams;
  const userId = params.get("userId");
  const lang = params.get("lang");
  const capability = params.get("capability");
  if (!userId || !isLang(lang) || !isCapability(capability)) {
    return Response.json({ error: "userId, lang and capability are required" }, { status: 400 });
  }
  if (await refusedGrant(who.viewer, [capability], lang)) return FORBIDDEN();
  if (removesOwnAdmin(who.viewer, who.userId, userId, capability)) {
    return Response.json({ error: "you cannot remove your own admin" }, { status: 403 });
  }

  await removeGrant(userId, lang, capability, who.userId);
  return listing(who.viewer);
}
