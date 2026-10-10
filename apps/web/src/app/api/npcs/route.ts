/**
 * An admin's answer about who is speaking: an NPC's type, gender and flavor, and its name in the
 * page's language (`?lang=`, English when absent). /npcs and the triage queue
 * (api/contributions/npc) both post here.
 *
 * Admin only: the answer is the same in every language and picks the voice of every line the
 * NPC speaks, so no language's moderator decides it for the others. Refused when the roster has
 * no place for it -- a type it does not have, a gender a genderless type cannot have, a flavor
 * the type is not voiced in -- because such an answer would voice nothing.
 *
 * Writes through to the NPC rather than the contribution, so one correction fixes every line
 * that NPC speaks -- which is the point of keying the table the way it is keyed.
 *
 * Always writes "moderator"/confirmed, even when a moderator clears race, gender and flavor
 * back to null. That is a real answer, not an empty one -- "this NPC has no race" is the same
 * normal outcome resolve.ts's own docstring describes for a corpus miss -- and it must stay
 * ranked "moderator" so a lower-ranked client guess can never silently overwrite a human's
 * considered "nothing here". Neither invariant in migration 0031 objects: the "none is empty"
 * check only constrains provenance "none", and the "confirmed implies corpus, display or moderator"
 * check is satisfied by "moderator" whether or not the row is confirmed.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireAdmin } from "@/lib/admin-guard";
import { INT32_MAX } from "@/lib/npc/npc";
import { getResolution, NPC_ROW_KINDS, renameNpc, resolutionKey, upsertResolution, type NpcRowKind } from "@/lib/npc/store";
import { loadRoster } from "@/lib/voices/roster-store";

export const dynamic = "force-dynamic";

// npcId is bounded by INT32_MAX, same as the intake path's -- see resolve.ts's digits() for why
// an upper bound matters here too: a moderator's own POST is authenticated, but nothing stops a
// mistyped or pasted id from being just as oversized, and the same out-of-range insert would
// fail the same way.

export async function POST(request: Request) {
  const { lang, session, denied } = await requireAdmin(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const npcKind = (NPC_ROW_KINDS as readonly string[]).includes(body.npcKind as string)
    ? (body.npcKind as NpcRowKind)
    : null;
  const npcId = Number(body.npcId);
  if (!npcKind) return Response.json({ error: "unknown kind" }, { status: 400 });
  // `< 0`, not `<= 0`: id 0 is a real NPC id (resolve.ts's own observedFrom/resolveNpc treat it
  // that way, with an explicit "not a truthiness check" note), and a moderator must be able to
  // correct it exactly like any other id the intake path resolved automatically.
  if (!Number.isInteger(npcId) || npcId < 0 || npcId > INT32_MAX) {
    return Response.json({ error: "unknown npc" }, { status: 400 });
  }

  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

  // What the client reported is kept even when a moderator overrules it: it is evidence about
  // the NPC, and the next person to look may want to know what the guess was based on.
  const existing = await getResolution(npcKind, npcId);

  // A name is its own answer: renaming an NPC confirms nothing about its voice.
  const npcName = text(body.npcName, 200);
  const answersVoice = ["race", "gender", "flavor", "doubtful", "note"].some((field) => field in body);
  if (npcName && !answersVoice && !existing) return Response.json({ error: "unknown npc" }, { status: 404 });

  // Absent from the body and sent-as-empty are different answers, and the form now posts race,
  // gender and flavor independently: a moderator confirming "this is a tauren male" has no
  // opinion on the flavor yet, and one who only has an opinion on the flavor of a client-guessed
  // row must not blank out the race and gender that guess already got right. `undefined` -- the
  // key was left off the POST entirely -- keeps whatever is already on the row (null, the first
  // time); `""` is still a real answer and still clears it, the same as before this existed, so
  // "lets a moderator clear every field" below keeps working unchanged.
  const orExisting = (value: unknown, current: string | null, max: number) =>
    value === undefined ? current : text(value, max);

  const race = orExisting(body.race, existing?.race ?? null, 64);
  const gender = orExisting(body.gender, existing?.gender ?? null, 16);
  const flavor = orExisting(body.flavor, existing?.flavor ?? null, 64);
  // Before the rename, so a refused answer changes nothing.
  if (answersVoice) {
    const refusal = (await loadRoster()).isAnswer(race, gender, flavor);
    if (refusal) return Response.json({ error: refusal }, { status: 400 });
  }

  if (npcName) await renameNpc(npcKind, npcId, npcName, session.user.id, lang);
  if (npcName && !answersVoice) return Response.json({ resolution: await getResolution(npcKind, npcId) });

  const row = await upsertResolution({
    npcKind,
    npcId,
    // Saved above, by renameNpc, when there is one.
    npcName: null,
    race,
    gender,
    flavor,
    provenance: "moderator",
    confirmed: true,
    // Sent on every save rather than kept when absent, unlike the fields above: a save is the
    // moderator's whole current answer, and one made without the flag is one they now stand by.
    doubtful: body.doubtful === true,
    modelFileId: existing?.modelFileId ?? null,
    sex: existing?.sex ?? null,
    creatureType: existing?.creatureType ?? null,
    build: existing?.build ?? null,
    note: orExisting(body.note, existing?.note ?? null, 2000),
    resolvedBy: session.user.id,
  });
  // Here rather than in upsertResolution, which intake calls too: only a person's answer is an
  // act. Logged under the language it was answered from, though it holds for every language.
  await recordActivity({
    kind: "npc.resolved",
    lang,
    actorId: session.user.id,
    subject: resolutionKey(npcKind, npcId),
    detail: {
      npcName: row.npcName,
      race: row.race,
      gender: row.gender,
      flavor: row.flavor,
      doubtful: row.doubtful,
    },
  });

  return Response.json({ resolution: row });
}
