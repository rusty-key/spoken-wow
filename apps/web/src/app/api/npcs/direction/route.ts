/**
 * `{ npcKind, npcId, direction }` sets an NPC's direction; an empty `direction` clears it.
 * Admin only: it changes every line the NPC speaks, in every language, and outdates their takes.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireAdmin } from "@/lib/generation/authz";
import { SettingsError, validateDirection } from "@/lib/generation/settings";
import { INT32_MAX } from "@/lib/npc/npc";
import { getResolution, NPC_ROW_KINDS, resolutionKey, setDirection, type NpcRowKind } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { lang, session, denied } = await requireAdmin(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const npcKind = (NPC_ROW_KINDS as readonly string[]).includes(body.npcKind as string)
    ? (body.npcKind as NpcRowKind)
    : null;
  const npcId = Number(body.npcId);
  if (!npcKind) return Response.json({ error: "unknown kind" }, { status: 400 });
  if (!Number.isInteger(npcId) || npcId < 0 || npcId > INT32_MAX) {
    return Response.json({ error: "unknown npc" }, { status: 400 });
  }

  const cleared = typeof body.direction === "string" && !body.direction.trim();
  let direction: string | null;
  try {
    direction = cleared ? null : validateDirection(body.direction, "NPC's");
  } catch (error) {
    if (error instanceof SettingsError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const npc = await getResolution(npcKind, npcId);
  if (!npc) return Response.json({ error: "unknown npc" }, { status: 404 });
  await setDirection(npcKind, npcId, direction);
  await recordActivity({
    kind: "npc.direction", lang, actorId: session.user.id, subject: resolutionKey(npcKind, npcId),
    detail: { npcName: npc.npcName, direction },
  });
  return Response.json({ direction });
}
