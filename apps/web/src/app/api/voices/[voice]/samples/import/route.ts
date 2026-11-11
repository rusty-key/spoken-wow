/**
 * Seed a voice's clips from voice/seed-clips.
 *
 * A static segment like `merge`, so it takes precedence over [file] and can never be read as
 * a clip name.
 *
 * The clips are copied server-side from voice/seed-clips rather than uploaded, then joined
 * into one file straight away. Two reasons for merging here rather than leaving it to a
 * second call: a flavor has up to 27 clips, well past the 25 an upload may carry, and a
 * clone reads whatever is in the folder - so the steady state has to be the one merged file
 * that cloning actually wants.
 */
import { recordActivities } from "@/lib/activity/store";
import { cloneName } from "@/lib/voices/clone-name";
import fs from "node:fs/promises";
import path from "node:path";

import { requireVoiceManager } from "@/lib/voices/authz";
import { DEFAULT_PAUSE_SECONDS, mergeSamples } from "@/lib/voices/merge";
import { seedClips } from "@/lib/voices/seedClips";
import { deleteSample, listSamples, storeSample } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  // A slot is shared; its clips and its clone are the language\'s own (clone-name.ts).
  const { session, lang, denied } = await requireVoiceManager(request, voice);
  if (denied) return denied;
  const clone = cloneName(voice, lang);

  let replace = false;
  try {
    const body = await request.json();
    replace = body?.replace === true;
  } catch {
    // A bare POST means "seed it if it is empty", which is the safe default.
  }

  const existing = await listSamples(clone);
  if (existing.length > 0 && !replace) {
    return Response.json(
      { error: `${voice} already has ${existing.length} clips; pass replace to overwrite` },
      { status: 409 },
    );
  }

  const clips = await seedClips(clone);
  if (clips.length === 0) {
    return Response.json(
      { error: `no seed clips for ${voice} in voice/seed-clips` },
      { status: 404 },
    );
  }

  // Clear first, so replacing cannot leave the old merge behind to be cloned alongside the
  // new one.
  for (const sample of existing) await deleteSample(clone, sample.file);

  const stored = [];
  for (const clip of clips) {
    stored.push(await storeSample(clone, path.basename(clip), await fs.readFile(clip)));
  }

  // A lone clip is already what a merge of it would be, and the filter graph has no
  // meaningful shape with nothing to join.
  let merged = stored.length === 1 ? stored[0] : null;
  if (!merged) {
    try {
      // The clone, like every other call here: the clips were stored under the language's
      // own directory, and the slot's is English's.
      merged = await mergeSamples(
        clone,
        stored.map((s) => s.file),
        DEFAULT_PAUSE_SECONDS,
      );
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
    for (const sample of stored) await deleteSample(clone, sample.file);
  }

  // Replacing threw away clips somebody uploaded, which is worth its own row.
  const act = { lang, actorId: session.user.id, subject: voice };
  await recordActivities([
    ...(existing.length
      ? [{ ...act, kind: "sample.deleted" as const, detail: { files: existing.map((s) => s.file) } }]
      : []),
    // The one clip the import leaves behind, not the seed clips it was joined from.
    { ...act, kind: "sample.imported" as const, detail: { files: [merged.file] } },
  ]);

  return Response.json(
    { voice, imported: stored.length, merged, samples: await listSamples(clone) },
    { status: 201 },
  );
}
