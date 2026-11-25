/**
 * `{ npcKind, npcId, direction }` sets an NPC's direction; an empty `direction` clears it.
 * Admin only: it changes every line the NPC speaks, in every language, and outdates their takes.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireAdmin } from "@/lib/generation/authz";
import { readDirectionRequest } from "@/lib/npc/direction-request";
import { resolutionKey, setDirection } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { lang, session, denied } = await requireAdmin(request);
  if (denied) return denied;
  const read = await readDirectionRequest(request);
  if (read instanceof Response) return read;
  const { npc, npcKind, npcId, direction } = read;

  await setDirection(npcKind, npcId, direction);
  await recordActivity({
    kind: "npc.direction", lang, actorId: session.user.id, subject: resolutionKey(npcKind, npcId),
    detail: { npcName: npc.npcName, direction },
  });
  return Response.json({ direction });
}
