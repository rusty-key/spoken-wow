/**
 * An admin's answer to "who speaks this?", for a quest contribution whose envelope named no
 * NPC at all.
 *
 * Recorded on the contribution (store.ts's setContributionNpc), as ../kind records a kind: `meta`
 * stays what the client sent, and every reader sees the row as if its envelope had carried the
 * NPC. Refused for a row whose envelope already named one -- the client's own observation stands.
 *
 * Then resolved like an envelope's own NPC at intake (resolveNpc), so one the corpus knows gets
 * its type at once. Admin only, as ../npc is: who speaks a line decides its voice in every
 * language.
 */
import { requireAdminSession } from "@/lib/admin-guard";
import { contributionLocale, observationMeta, setContributionNpc } from "@/lib/contributions/store";
import { isLang } from "@/lib/lang";
import { INT32_MAX, NPC_KINDS, type NpcKind } from "@/lib/npc/npc";
import { observedFrom, resolveNpc } from "@/lib/npc/resolve";
import type { NpcResolution } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0 || id > INT32_MAX) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }
  if (!(NPC_KINDS as readonly unknown[]).includes(body.npcKind)) {
    return Response.json({ error: "unknown kind" }, { status: 400 });
  }
  const npcKind = body.npcKind as NpcKind;
  // `< 0`, not `<= 0` -- id 0 is a real NPC id (see ../npc).
  const npcId = body.npcId;
  if (typeof npcId !== "number" || !Number.isInteger(npcId) || npcId < 0 || npcId > INT32_MAX) {
    return Response.json({ error: "an NPC id is required" }, { status: 400 });
  }
  const npcName = typeof body.npcName === "string" ? body.npcName.trim().slice(0, 200) : "";
  if (!npcName) return Response.json({ error: "an NPC name is required" }, { status: 400 });

  // Permission before existence, as ../kind does, so a member learns nothing about which ids exist.
  const { session, denied } = await requireAdminSession();
  if (denied) return denied;
  const locale = await contributionLocale(id);

  const recorded = await setContributionNpc(id, { npcKind, npcId, npcName }, session.user.id);
  if (!recorded) {
    return Response.json(
      { error: "no such quest contribution, or its envelope already names its NPC" },
      { status: 409 },
    );
  }

  // A failure here must not fail the answer, which is already recorded: the triage page resolves
  // any NPC it finds unresolved on its next render, as it does for an envelope's own.
  let resolution: NpcResolution | null = null;
  try {
    // Read back through observationMeta, as every other reader of the row does, so what gets
    // resolved is exactly what triage, accept and the export will see.
    resolution = await resolveNpc(observedFrom(observationMeta(recorded)), isLang(locale) ? locale : null);
  } catch {
    resolution = null;
  }

  return Response.json({ ok: true, resolution });
}
