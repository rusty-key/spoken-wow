/**
 * Fill a slot with a voice already in the caller's ElevenLabs account, by renaming it to the
 * slot's clone name.
 *
 * The generator resolves voices by name (listVoices), so renaming is the whole binding: no
 * voice id is stored, and the voice works for whoever's account it is in, exactly as a clone
 * made from clips would. Open to the same callers as cloning, for the same reason - it
 * changes only the caller's own account.
 *
 * A slot already filled is renamed out of the way rather than deleted: the voice it held may
 * be a library voice or a designed one with no clips behind it, and deleting it would lose
 * it for good. Its new name matches no slot, so it stops being used.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireApiKey } from "@/lib/generation/authz";
import { invalidateStatus } from "@/lib/generation/status";
import { requireVoiceViewer } from "@/lib/voices/authz";
import { cloneName } from "@/lib/voices/clone-name";
import { recordClone } from "@/lib/voices/clones";
import { isRenamable, listAccountVoices, renameVoice } from "@/lib/voices/elevenlabs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  const { session, lang, manager, denied } = await requireVoiceViewer(request, voice);
  if (denied) return denied;
  const clone = cloneName(voice, lang);

  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const voiceId = typeof body.voiceId === "string" ? body.voiceId : null;
  const replace = body.replace === true;
  if (!voiceId) return Response.json({ error: "voiceId is required" }, { status: 400 });

  let account;
  try {
    account = await listAccountVoices({ apiKey: key });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }

  const picked = account.find((candidate) => candidate.voiceId === voiceId);
  if (!picked) {
    return Response.json({ error: "that voice is not in your ElevenLabs account" }, { status: 404 });
  }
  if (picked.name === clone) {
    return Response.json({ voice, voiceId, replaced: false }, { status: 200 });
  }
  if (!isRenamable(picked)) {
    return Response.json(
      { error: `"${picked.name}" is an ElevenLabs premade voice and cannot be renamed` },
      { status: 400 },
    );
  }

  // Every voice holding the name, not only the first: two would make the lookup by name
  // pick whichever ElevenLabs lists first.
  const current = account.filter((candidate) => candidate.name === clone);
  if (current.length > 0 && !replace) {
    return Response.json(
      { error: `"${clone}" already exists; replacing it renames the current voice` },
      { status: 409 },
    );
  }

  for (const occupant of current) {
    try {
      await renameVoice(occupant.voiceId, `${clone} (replaced)`, { apiKey: key });
    } catch (error) {
      return Response.json({ error: `could not replace: ${message(error)}` }, { status: 502 });
    }
  }

  try {
    await renameVoice(voiceId, clone, { apiKey: key });
  } catch (error) {
    const moved = current.length
      ? ` The previous voice is now "${clone} (replaced)"; rename it back in ElevenLabs or retry.`
      : "";
    return Response.json({ error: message(error) + moved }, { status: 502 });
  }

  invalidateStatus();

  await recordActivity({
    kind: "voice.adopted",
    lang,
    actorId: session.user.id,
    subject: voice,
    detail: { voiceId, from: picked.name },
  });

  // Provenance for an admin's, as with a clone (clone/route.ts); zero samples is what says
  // it was adopted rather than cloned from clips here.
  let warning: string | undefined;
  if (manager) {
    try {
      await recordClone({
        voice,
        voiceId,
        clonedBy: session.user.id,
        sampleCount: 0,
        sampleBytes: 0,
        lang,
      });
    } catch (error) {
      warning = `the voice was adopted but its provenance was not recorded: ${message(error)}`;
      console.error(`voice_clone insert failed for ${clone}:`, error);
    }
  }

  return Response.json(
    { voice, voiceId, replaced: current.length > 0, warning },
    { status: 201 },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
