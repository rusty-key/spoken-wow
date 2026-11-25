/**
 * `{ npcKind, npcId, direction }` sets an NPC's direction in the `?lang=` language, over its
 * global one; an empty `direction` clears it back to the global one.
 *
 * Whoever configures the language: like its race directions, it changes how that language's
 * voices perform and outdates its takes, and no other language's. English has none of its own,
 * since the global direction is English's.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireIn } from "@/lib/generation/authz";
import { SettingsError, validateDirection } from "@/lib/generation/settings";
import { BASE_LANG } from "@/lib/lang";
import { INT32_MAX } from "@/lib/npc/npc";
import { getResolution, NPC_ROW_KINDS, resolutionKey, setLanguageDirection, type NpcRowKind } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { lang, session, denied } = await requireIn(request, "configure");
  if (denied) return denied;
  if (lang === BASE_LANG) return Response.json({ error: "English uses the global direction" }, { status: 400 });

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
  await setLanguageDirection(npcKind, npcId, lang, direction, session.user.id);
  await recordActivity({
    kind: "npc.direction", lang, actorId: session.user.id, subject: resolutionKey(npcKind, npcId),
    detail: { npcName: npc.npcName, direction, inLanguage: true },
  });
  return Response.json({ direction });
}
