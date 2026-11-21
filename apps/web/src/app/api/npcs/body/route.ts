/**
 * An admin's answer for one body of a split NPC, and splitting or unsplitting it. A body is a
 * race and a sex (migration 0075).
 *
 *   { npcKind, npcId, action: "split" }              the other sex of the NPC's own race
 *   { npcKind, npcId, action: "add", race, sex }     another body, its default flavor doubtful
 *   { npcKind, npcId, action: "remove", race, sex }  one body away; the second-last unsplits
 *   { npcKind, npcId, action: "unsplit" }            every line back to the NPC's one voice
 *   { npcKind, npcId, race, sex, flavor, doubtful }  a moderator's answer for that body
 *
 * Admin only: the answer voices every line the NPC speaks, in every language.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireAdmin } from "@/lib/generation/authz";
import { INT32_MAX, isSex, oppositeSex, SEX_GENDER, sexOf, type Sex } from "@/lib/npc/npc";
import { splitNpc } from "@/lib/npc/split";
import {
  deleteBody, getBodies, getResolution, resolutionKey, unsplit, upsertBody, type NpcBodyAnswer, type NpcResolution, type NpcRowKind,
} from "@/lib/npc/store";
import { defaultFlavorFor } from "@/lib/quests/catalogue";
import { loadRoster } from "@/lib/voices/roster-store";

export const dynamic = "force-dynamic";

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/**
 * A new body for `npc`, splitting it with its own body kept as a moderator's answer. Its own body,
 * on an NPC split without it, is that answer itself: there is nothing to split it from.
 */
async function addBody(
  npc: NpcResolution, race: string, sex: Sex, resolvedBy: string, bodies: NpcBodyAnswer[],
): Promise<void> {
  if (race === npc.race && sex === sexOf(npc.gender)) {
    await upsertBody({
      npcKind: npc.npcKind, npcId: npc.npcId, race, sex, weight: null, flavor: npc.flavor,
      provenance: "moderator", confirmed: true, doubtful: false, note: null, resolvedBy,
    });
    return;
  }
  await splitNpc(npc, {
    npcKind: npc.npcKind, npcId: npc.npcId, race, sex, weight: null,
    flavor: await defaultFlavorFor(race, SEX_GENDER[sex]),
    provenance: "moderator", confirmed: true, doubtful: true, note: null, resolvedBy,
  }, { provenance: "moderator", confirmed: true, doubtful: false, resolvedBy }, bodies);
}

export async function POST(request: Request) {
  const { lang, session, denied } = await requireAdmin(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Only a creature is drawn with a body.
  const npcKind: NpcRowKind | null = body.npcKind === "creature" ? "creature" : null;
  const npcId = Number(body.npcId);
  if (!npcKind) return Response.json({ error: "only a creature can be split by body" }, { status: 400 });
  if (!Number.isInteger(npcId) || npcId < 0 || npcId > INT32_MAX) {
    return Response.json({ error: "unknown npc" }, { status: 400 });
  }
  const npc = await getResolution(npcKind, npcId);
  if (!npc) return Response.json({ error: "unknown npc" }, { status: 404 });

  const subject = resolutionKey(npcKind, npcId);
  const actorId = session.user.id;
  const bodies = await getBodies(npcKind, npcId);

  if (body.action === "unsplit") {
    await unsplit(npcKind, npcId);
    await recordActivity({ kind: "npc.unsplit", lang, actorId, subject, detail: { npcName: npc.npcName } });
    return Response.json({ bodies: [] });
  }

  // A beast's or a generic creature's type has no gender, and the roster no voice for a body of it.
  const own = sexOf(npc.gender);
  if (!npc.race || own === null) return Response.json({ error: "answer the NPC as a man or a woman first" }, { status: 400 });

  if (body.action === "split") {
    await addBody(npc, npc.race, oppositeSex(own), actorId, bodies);
    await recordActivity({ kind: "npc.split", lang, actorId, subject, detail: { npcName: npc.npcName } });
    return Response.json({ bodies: await getBodies(npcKind, npcId) });
  }

  const sex = Number(body.sex);
  if (!isSex(sex)) return Response.json({ error: "sex is 2 or 3" }, { status: 400 });
  const race = text(body.race, 64);
  if (!race) return Response.json({ error: "a body needs a type" }, { status: 400 });
  const roster = await loadRoster(lang);

  if (body.action === "add") {
    const exists = bodies.some((row) => row.race === race && row.sex === sex) ||
      (!bodies.length && race === npc.race && sex === own);
    if (exists) return Response.json({ error: "the NPC has that body already" }, { status: 400 });
    const refusal = roster.isAnswer(race, SEX_GENDER[sex], null);
    if (refusal) return Response.json({ error: refusal }, { status: 400 });
    await addBody(npc, race, sex, actorId, bodies);
    await recordActivity({ kind: "npc.split", lang, actorId, subject, detail: { npcName: npc.npcName, race, sex } });
    return Response.json({ bodies: await getBodies(npcKind, npcId) });
  }

  if (body.action === "remove") {
    await deleteBody(npcKind, npcId, race, sex);
    await recordActivity({ kind: "npc.unsplit", lang, actorId, subject, detail: { npcName: npc.npcName, race, sex } });
    return Response.json({ bodies: await getBodies(npcKind, npcId) });
  }

  // An answer for a body the NPC does not have would leave it half split: adding comes first.
  if (!bodies.some((row) => row.race === race && row.sex === sex)) {
    return Response.json({ error: "add the body first" }, { status: 400 });
  }
  const flavor = text(body.flavor, 64);
  const refusal = roster.isAnswer(race, SEX_GENDER[sex], flavor);
  if (refusal) return Response.json({ error: refusal }, { status: 400 });
  const row = await upsertBody({
    npcKind, npcId, race, sex, weight: null, flavor, provenance: "moderator", confirmed: true,
    doubtful: body.doubtful === true, note: null, resolvedBy: actorId,
  });
  await recordActivity({
    kind: "npc.resolved", lang, actorId, subject,
    detail: { npcName: npc.npcName, sex, race: row.race, gender: row.gender, flavor: row.flavor, doubtful: row.doubtful },
  });
  return Response.json({ bodies: await getBodies(npcKind, npcId) });
}
