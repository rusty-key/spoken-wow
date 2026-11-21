/**
 * Join selected clips into one.
 *
 * A static segment, so it takes precedence over [file] and `merge` can never be read as a
 * clip name.
 *
 * Deleting the sources is opt-in here, though the UI ticks it by default: cloning sends
 * every clip in the folder, so originals left beside a merge would be uploaded twice. The
 * API keeps them unless asked, so a caller that has not thought about it does not lose the
 * only copies.
 */
import { recordActivities } from "@/lib/activity/store";
import { cloneName } from "@/lib/voices/clone-name";
import { requireVoiceManager } from "@/lib/voices/authz";
import { DEFAULT_PAUSE_SECONDS, mergeSamples, rejectMerge } from "@/lib/voices/merge";
import { deleteSample, isStoredSampleName, listSamples } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  // A slot is shared; its clips and its clone are the language\'s own (clone-name.ts).
  const { session, lang, denied } = await requireVoiceManager(request, voice);
  if (denied) return denied;
  const clone = cloneName(voice, lang);

  let body: { files?: unknown; pauseSeconds?: unknown; deleteSources?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === "string") : [];
  if (!files.every(isStoredSampleName)) {
    return Response.json({ error: "bad clip name" }, { status: 400 });
  }

  const pauseSeconds =
    typeof body.pauseSeconds === "number" ? body.pauseSeconds : DEFAULT_PAUSE_SECONDS;

  const reason = rejectMerge(files, pauseSeconds);
  if (reason) return Response.json({ error: reason }, { status: 400 });

  let merged;
  try {
    merged = await mergeSamples(clone, files, pauseSeconds);
  } catch (error) {
    // ffmpeg's own message is the only clue to a bad input, so it is passed through.
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  const deleted: string[] = [];
  if (body.deleteSources === true) {
    for (const file of files) if (await deleteSample(clone, file)) deleted.push(file);
  }
  // The sources' deletion is its own row: "merged" alone would read as if they were kept.
  const act = { lang, actorId: session.user.id, subject: voice };
  await recordActivities([
    { ...act, kind: "sample.merged", detail: { files, into: merged.file } },
    ...(deleted.length ? [{ ...act, kind: "sample.deleted" as const, detail: { files: deleted } }] : []),
  ]);

  return Response.json({ voice, merged, samples: await listSamples(clone) }, { status: 201 });
}
