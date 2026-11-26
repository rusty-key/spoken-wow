/** A direction route's body: `{ npcKind, npcId, direction }`, an empty `direction` clearing it. */
import { recordActivity } from "@/lib/activity/store";
import { bodyOf, objectOf } from "@/lib/api-body";
import { SettingsError, validateDirection } from "@/lib/generation/settings";
import type { Lang } from "@/lib/lang";
import { INT32_MAX } from "@/lib/npc/npc";
import { getResolution, NPC_ROW_KINDS, resolutionKey, setLanguageDirection, type NpcResolution, type NpcRowKind } from "@/lib/npc/store";

export const NO_LANGUAGE_DIRECTION = "English uses the global direction";

export type DirectionRequest = { npc: NpcResolution; npcKind: NpcRowKind; npcId: number; direction: string | null };

/** The NPC on file and its direction, bracketed, or the response refusing them. */
export async function readDirectionRequest(request: Request): Promise<DirectionRequest | Response> {
  return directionRequest(objectOf(await bodyOf(request)) ?? {});
}

export async function directionRequest(body: Record<string, unknown>): Promise<DirectionRequest | Response> {
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
  return { npc, npcKind, npcId, direction };
}

/** The acting team's direction for the NPC in `lang`, logged as `by`'s act. */
export async function applyLanguageDirection(read: DirectionRequest, lang: Lang, by: string): Promise<void> {
  const { npc, npcKind, npcId, direction } = read;
  await setLanguageDirection(npcKind, npcId, lang, direction, by);
  await recordActivity({
    kind: "npc.direction", lang, actorId: by, subject: resolutionKey(npcKind, npcId),
    detail: { npcName: npc.npcName, direction, inLanguage: true },
  });
}
