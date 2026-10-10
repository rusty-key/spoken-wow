/**
 * A moderator's answer about who is speaking.
 *
 * A sibling of the public POST rather than a verb on it, for the reason
 * api/reports/resolve/route.ts gives: that path is open to the whole internet and this one must
 * never be. Regenerate in the page's language (`?lang=`, English when absent): a line only
 * another language has is voiced once that language's moderator says who speaks it, and what
 * they answer is the NPC's race and gender, the same in every language.
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
import { requireIn } from "@/lib/generation/authz";
import { INT32_MAX } from "@/lib/npc/npc";
import { getResolution, NPC_KINDS, resolutionKey, upsertResolution, type NpcKind } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

// npcId is bounded by INT32_MAX, same as the intake path's -- see resolve.ts's digits() for why
// an upper bound matters here too: a moderator's own POST is authenticated, but nothing stops a
// mistyped or pasted id from being just as oversized, and the same out-of-range insert would
// fail the same way.

export async function POST(request: Request) {
  const { lang, session, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const npcKind = (NPC_KINDS as readonly string[]).includes(body.npcKind as string)
    ? (body.npcKind as NpcKind)
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

  // Absent from the body and sent-as-empty are different answers, and the form now posts race,
  // gender and flavor independently: a moderator confirming "this is a tauren male" has no
  // opinion on the flavor yet, and one who only has an opinion on the flavor of a client-guessed
  // row must not blank out the race and gender that guess already got right. `undefined` -- the
  // key was left off the POST entirely -- keeps whatever is already on the row (null, the first
  // time); `""` is still a real answer and still clears it, the same as before this existed, so
  // "lets a moderator clear every field" below keeps working unchanged.
  const orExisting = (value: unknown, current: string | null, max: number) =>
    value === undefined ? current : text(value, max);

  const row = await upsertResolution({
    npcKind,
    npcId,
    npcName: existing?.npcName ?? null,
    race: orExisting(body.race, existing?.race ?? null, 64),
    gender: orExisting(body.gender, existing?.gender ?? null, 16),
    flavor: orExisting(body.flavor, existing?.flavor ?? null, 64),
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
