/**
 * Every voice in the caller's ElevenLabs account, for the picker that adopts one into a slot.
 *
 * `slot` says which slot a voice already fills, in any language, so the picker can show that
 * choosing it moves it rather than copies it: an account voice has one name.
 */
import { requireApiKey } from "@/lib/generation/authz";
import { requireVoiceViewer } from "@/lib/voices/authz";
import { parseCloneName } from "@/lib/voices/clone-name";
import { isRenamable, listAccountVoices } from "@/lib/voices/elevenlabs";
import { isVoiceSlot } from "@/lib/voices/slots";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { session, denied } = await requireVoiceViewer(request);
  if (denied) return denied;
  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  let voices;
  try {
    voices = await listAccountVoices({ apiKey: key });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }

  return Response.json({
    voices: await Promise.all(
      voices.map(async (voice) => {
        const clone = parseCloneName(voice.name);
        return {
          ...voice,
          renamable: isRenamable(voice),
          slot: clone && (await isVoiceSlot(clone.voice, clone.lang)) ? voice.name : null,
        };
      }),
    ),
  });
}
