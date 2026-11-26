/** A direction route's body: `{ npcKind, npcId, direction }`, an empty `direction` clearing it. */
import { SettingsError, validateDirection } from "@/lib/generation/settings";
import { INT32_MAX } from "@/lib/npc/npc";
import { getResolution, NPC_ROW_KINDS, type NpcResolution, type NpcRowKind } from "@/lib/npc/store";

export type DirectionRequest = { npc: NpcResolution; npcKind: NpcRowKind; npcId: number; direction: string | null };

/** The NPC on file and its direction, bracketed, or the response refusing them. */
export async function readDirectionRequest(request: Request): Promise<DirectionRequest | Response> {
  return directionRequest((await request.json().catch(() => ({}))) as Record<string, unknown>);
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
