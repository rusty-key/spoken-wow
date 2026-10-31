/**
 * What one line should say instead of what the corpus says it says.
 *
 * `regenerate` in English, matching regeneration rather than the lexicon: an override changes one file,
 * and the person who would have to listen to the result is the person regenerating it. A
 * lexicon rule, by contrast, applies to everything anyone generates afterwards.
 *
 * Keyed on the file, so the same whitelist that makes the audio routes traversal-proof decides
 * what may be written: a path either names a file some corpus line owns, or it does not exist.
 *
 * Text that branches on `$G` is written to the moment's lines instead (quests/english-rewrite.ts):
 * both sides of a split moment, or a plain line split into them.
 */
import { fileIndex } from "@/lib/audio";
import { requireRegenerate } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { branchesOnPlayerGender } from "@/lib/player-words";
import { englishMomentLines, rewriteEnglish } from "@/lib/quests/english-rewrite";
import { OverrideError, validateRewrite } from "@/lib/quests/override";
import { clearOverride, writeOverride } from "@/lib/quests/overrides";
import { QuestTextConflict } from "@/lib/quests/text";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  let draft;
  try {
    draft = validateRewrite(await request.json());
  } catch (error) {
    // A validation failure is the caller's fault and a JSON parse failure is too, so both are
    // 400 - but only OverrideError text is safe to hand back verbatim.
    const message = error instanceof OverrideError ? error.message : "invalid override body";
    return Response.json({ error: message }, { status: 400 });
  }

  const line = (await fileIndex()).get(draft.file);
  if (!line) return Response.json({ error: "unknown file" }, { status: 404 });

  if (branchesOnPlayerGender(draft.text)) {
    const variant = line.variant ?? 0;
    try {
      const rows = await englishMomentLines(line.lineId, variant);
      // The file is the corpus's, so its moment has lines unless they moved since it was indexed.
      if (rows.length === 0) return Response.json({ error: "unknown line" }, { status: 404 });
      const { files } = await rewriteEnglish(rows, variant, { text: draft.text, userId: session.user.id });
      return Response.json({ files });
    } catch (error) {
      if (error instanceof OverrideError) return Response.json({ error: error.message }, { status: 400 });
      if (error instanceof QuestTextConflict) return Response.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }

  const override = await writeOverride(draft.file, draft.lineId, draft.text, session.user.id, BASE_LANG);
  return Response.json({ override });
}

export async function DELETE(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const file = new URL(request.url).searchParams.get("file");
  if (!file || !(await fileIndex()).has(file)) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }

  // Answering 200 for a file that had no override: the caller asked for it to be gone and it
  // is gone, and a 404 would make "revert" fail on a second click.
  return Response.json({ removed: await clearOverride(file, session.user.id, BASE_LANG) });
}
