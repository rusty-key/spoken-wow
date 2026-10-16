/**
 * An admin's direction for one NPC's voice, or clearing it:
 *
 *   { npcKind, npcId, direction: "pirate accent" }   sent in front of every line only it speaks
 *   { npcKind, npcId, direction: "" }                cleared
 *
 * Admin only, as the race directions are: it changes every line the NPC speaks, in every
 * language, and marks their takes outdated.
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

  let direction: string | null = null;
  if (typeof body.direction !== "string" || body.direction.trim()) {
    try {
      direction = validateDirection(body.direction, "NPC's");
    } catch (error) {
      if (error instanceof SettingsError) return Response.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }

  const npc = await getResolution(npcKind, npcId);
  if (!npc || !(await setDirection(npcKind, npcId, direction))) {
    return Response.json({ error: "unknown npc" }, { status: 404 });
  }
  await recordActivity({
    kind: "npc.direction", lang, actorId: session.user.id, subject: resolutionKey(npcKind, npcId),
    detail: { npcName: npc.npcName, direction },
  });
  return Response.json({ direction });
}
