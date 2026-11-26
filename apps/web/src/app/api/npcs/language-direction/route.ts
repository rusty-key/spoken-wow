/**
 * `{ npcKind, npcId, direction }` sets an NPC's direction in the `?lang=` language, replacing the
 * global one there; an empty `direction` clears it. Needs `configure` there, since it outdates
 * that language's takes. English has none: the global direction is English's.
 */
import { requireIn } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { applyLanguageDirection, NO_LANGUAGE_DIRECTION, readDirectionRequest } from "@/lib/npc/direction-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { lang, session, denied } = await requireIn(request, "configure");
  if (denied) return denied;
  if (lang === BASE_LANG) return Response.json({ error: NO_LANGUAGE_DIRECTION }, { status: 400 });
  const read = await readDirectionRequest(request);
  if (read instanceof Response) return read;
  await applyLanguageDirection(read, lang, session.user.id);
  return Response.json({ direction: read.direction });
}
