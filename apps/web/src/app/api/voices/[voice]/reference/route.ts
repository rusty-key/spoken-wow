/**
 * One voice slot's fish.audio reference, in one language: cut it, correct its transcript,
 * pin the slot to fish.audio, or remove it.
 *
 * Cutting transcribes the clip with fish.audio, and that is spent from the admin's own
 * fish.audio key -- the rule every other paid action here follows. It costs a fraction of a
 * cent, but a server-wide key would still leave "who paid" with no answer.
 */
import { requireApiKey } from "@/lib/generation/authz";
import { elevenLabsCode } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { requireVoiceManager, requireVoiceViewer } from "@/lib/voices/authz";
import { cloneName } from "@/lib/voices/clone-name";
import { transcribe } from "@/lib/voices/fish";
import {
  deleteReference,
  readReference,
  rejectWindow,
  savePinned,
  saveReference,
  saveTranscript,
} from "@/lib/voices/references";
import { isStoredSampleName, withSampleFiles } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

async function guard(request: Request, voice: string) {
  const { session, denied } = await requireVoiceManager(voice);
  if (denied) return { denied } as const;
  const { lang, denied: noLang } = await langParam(request);
  if (noLang) return { denied: noLang } as const;
  return { denied: null, lang, session } as const;
}

export async function GET(request: Request, context: Context) {
  const { voice } = await context.params;
  const { lang, denied } = await requireVoiceViewer(request, voice);
  if (denied) return denied;

  return Response.json({ reference: await readReference(voice, lang) });
}

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  const checked = await guard(request, voice);
  if (checked.denied) return checked.denied;
  const { lang, session } = checked;

  const body = (await request.json().catch(() => ({}))) as {
    sample?: unknown;
    startSec?: unknown;
    endSec?: unknown;
  };
  const sample = typeof body.sample === "string" ? body.sample : "";
  const startSec = Number(body.startSec);
  const endSec = Number(body.endSec);
  // The name is checked before it becomes a path: only names this app generated are files.
  if (!isStoredSampleName(sample)) return Response.json({ error: "pick one of the clips" }, { status: 400 });
  const rejected = rejectWindow(startSec, endSec);
  if (rejected) return Response.json({ error: rejected }, { status: 400 });

  const { key, denied: noKey } = await requireApiKey(session.user.id, "fish");
  if (noKey) return noKey;

  try {
    // The language's own clips, where its clone's clips are (clone-name.ts).
    const reference = await withSampleFiles(cloneName(voice, lang), [sample], ([sourcePath]) =>
      saveReference({
        voice,
        lang,
        sample,
        sourcePath,
        startSec,
        endSec,
        userId: session.user.id,
        transcribe: (audio) => transcribe(audio, elevenLabsCode(lang), { apiKey: key }),
      }),
    );
    return Response.json({ reference });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

/** A corrected transcript, or the pin. The audio stays as cut. */
export async function PATCH(request: Request, context: Context) {
  const { voice } = await context.params;
  const checked = await guard(request, voice);
  if (checked.denied) return checked.denied;

  const body = (await request.json().catch(() => ({}))) as { transcript?: unknown; pinned?: unknown };
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") {
      return Response.json({ error: "pinned is true or false" }, { status: 400 });
    }
    const reference = await savePinned(voice, checked.lang, body.pinned, checked.session.user.id);
    if (!reference) return Response.json({ error: "no reference to pin" }, { status: 404 });
    return Response.json({ reference });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  if (!transcript.trim()) return Response.json({ error: "a transcript cannot be empty" }, { status: 400 });

  const reference = await saveTranscript(voice, checked.lang, transcript, checked.session.user.id);
  if (!reference) return Response.json({ error: "no reference to correct" }, { status: 404 });
  return Response.json({ reference });
}

export async function DELETE(request: Request, context: Context) {
  const { voice } = await context.params;
  const checked = await guard(request, voice);
  if (checked.denied) return checked.denied;

  await deleteReference(voice, checked.lang, checked.session.user.id);
  return Response.json({ reference: null });
}
