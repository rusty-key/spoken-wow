/**
 * `{ npcKind, npcId, direction }` sets an NPC's direction in the `?lang=` language, replacing the
 * global one there; an empty `direction` clears it. Needs `configure` there, since it outdates
 * that language's takes. English has none: the global direction is English's.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireIn } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { readDirectionRequest } from "@/lib/npc/direction-request";
import { resolutionKey, setLanguageDirection } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { lang, session, denied } = await requireIn(request, "configure");
  if (denied) return denied;
  if (lang === BASE_LANG) return Response.json({ error: "English uses the global direction" }, { status: 400 });
  const read = await readDirectionRequest(request);
  if (read instanceof Response) return read;
  const { npc, npcKind, npcId, direction } = read;

  await setLanguageDirection(npcKind, npcId, lang, direction, session.user.id);
  await recordActivity({
    kind: "npc.direction", lang, actorId: session.user.id, subject: resolutionKey(npcKind, npcId),
    detail: { npcName: npc.npcName, direction, inLanguage: true },
  });
  return Response.json({ direction });
}
