/**
 * The session, or a 403, for what only a global admin may do: say who an NPC is, and edit the
 * types an NPC can be.
 *
 * An NPC's type and voice hold in every language, so no language grant is enough to set them.
 * The language still comes from `?lang=`, because a rename is saved in it and the activity log
 * files the answer under it.
 */
import type { Session } from "@/lib/generation/authz";
import type { Lang } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

export async function requireAdminSession(): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) return { session: null, denied: FORBIDDEN() };
  return { session, denied: null };
}

export async function requireAdmin(
  request: Request,
): Promise<
  | { lang: Lang; session: NonNullable<Session>; denied: null }
  | { lang: null; session: null; denied: Response }
> {
  const { lang, denied } = await langParam(request);
  if (denied) return { lang: null, session: null, denied };
  const guard = await requireAdminSession();
  if (guard.denied) return { lang: null, session: null, denied: guard.denied };
  return { lang, session: guard.session, denied: null };
}
