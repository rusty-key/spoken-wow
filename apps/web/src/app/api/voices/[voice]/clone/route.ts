/**
 * Turn a voice's clips into an ElevenLabs voice, in the caller's own account.
 *
 * Open to anybody who spends in the language, not only to admins: the generator resolves
 * voices by name against the key generating, so each collaborator needs the roster in their
 * own account, and this is how they put it there. It changes nothing anybody else uses — the
 * clips it reads stay an admin's to change.
 *
 * This is the endpoint that spends something: a custom voice slot, capped by the plan.
 * Replacing is delete-then-add rather than an update, because ElevenLabs has no "re-train
 * this voice" call and two voices sharing a name would make the lookup by name ambiguous —
 * it would pick whichever came back first.
 */
import { cloneName } from "@/lib/voices/clone-name";

import { recordActivity } from "@/lib/activity/store";
import { requireApiKey } from "@/lib/generation/authz";
import { invalidateStatus } from "@/lib/generation/status";
import { requireVoiceViewer } from "@/lib/voices/authz";
import { recordClone } from "@/lib/voices/clones";
import { addVoice, deleteVoice, listVoices } from "@/lib/voices/elevenlabs";
import { listSamples, readSample } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  const { session, lang, manager, denied } = await requireVoiceViewer(request, voice);
  if (denied) return denied;
  // A slot is shared; its clips and its clone are the language\'s own (clone-name.ts).
  const clone = cloneName(voice, lang);

  // A clone is created on somebody's account, and there is no server account to create it
  // on. Which one it lands in matters beyond the bill: the generator resolves voices by name
  // against the key generating, so a voice cloned into an account nobody generates with is
  // a voice that does not exist as far as every line is concerned.
  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const replace = body.replace === true;

  const samples = await listSamples(clone);
  if (samples.length === 0) {
    return Response.json({ error: "this voice has no clips to clone from yet" }, { status: 400 });
  }

  // Read the account rather than the provenance table: a voice created in the ElevenLabs
  // dashboard is just as real to the generator, and refusing to notice it would let this
  // create a second voice with the same name.
  let existing: Map<string, string>;
  try {
    existing = await listVoices({ apiKey: key });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }

  const current = existing.get(clone);
  if (current && !replace) {
    return Response.json(
      { error: `"${clone}" already exists; replacing it deletes the current voice` },
      { status: 409 },
    );
  }

  const clips = await Promise.all(
    samples.map(async (sample) => {
      const data = await readSample(clone, sample.file);
      if (!data) throw new Error(`clip ${sample.file} is missing`);
      return { name: sample.file, data };
    }),
  );

  // Deleted first: ElevenLabs rejects a duplicate name, and a failure here must stop the
  // request rather than leave the old voice in place while reporting success.
  if (current) {
    try {
      await deleteVoice(current, { apiKey: key });
    } catch (error) {
      return Response.json({ error: `could not replace: ${message(error)}` }, { status: 502 });
    }
  }

  let voiceId: string;
  try {
    voiceId = await addVoice(clone, clips, { apiKey: key });
  } catch (error) {
    // The window that matters: the old voice is gone and the new one failed, so the slot is
    // empty. The clips are all still on disk, so retrying is the fix - say so.
    const lost = current ? " The previous voice was deleted; the clips are intact, so retry." : "";
    return Response.json({ error: message(error) + lost }, { status: 502 });
  }

  // The explorer asks which voices exist through a memo with a minute-long TTL, and the
  // Regenerate button is disabled while a slot reads as empty. Without this, a voice created
  // here stays unusable for up to a minute with nothing on screen explaining why.
  invalidateStatus();

  // Everybody's clone, unlike the provenance row below: the log answers who did what in the
  // language, and a translator cloning into their own account did something.
  await recordActivity({
    kind: "voice.cloned",
    lang,
    actorId: session.user.id,
    subject: voice,
    detail: { voiceId, sampleCount: samples.length },
  });

  // The voice exists by this point, and this table is explicitly not what decides that -
  // listVoices is. So a provenance write that fails must not report the clone as failed,
  // which would leave the operator re-creating a voice they already have.
  //
  // An admin's clone only. The table holds one row per voice and language, and is the answer
  // to where the roster came from; every collaborator populating their own account would
  // otherwise overwrite it with themselves.
  let warning: string | undefined;
  if (manager) {
    try {
      await recordClone({
        voice,
        voiceId,
        clonedBy: session.user.id,
        sampleCount: samples.length,
        sampleBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0),
        lang,
      });
    } catch (error) {
      warning = `the voice was created but its provenance was not recorded: ${message(error)}`;
      console.error(`voice_clone insert failed for ${clone}:`, error);
    }
  }

  return Response.json({ voice, voiceId, replaced: Boolean(current), warning }, { status: 201 });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
