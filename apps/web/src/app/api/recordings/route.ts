/**
 * A file's voice-actor recordings: list them, upload one, remove one.
 *
 *   GET    /api/recordings?lang=deDE&source=places&file=1411/razor-hill
 *   POST   /api/recordings?lang=deDE   multipart: source, file, audio
 *   DELETE /api/recordings?lang=deDE&source=places&file=1411/razor-hill&version=2
 *
 * All behind `record` in the language (0061): an actor hears every actor's takes there,
 * which is how they match each other. Removing is the author's, or a global admin's.
 *
 * One file per POST. The bulk drop zone sends them one after another, so a 25 MiB cap holds
 * per request and one bad file fails alone. Buffered through formData() as the voice samples
 * route is; nginx's limit for /api/recordings/ is set to match (deploy/web/nginx-spoken-api.conf).
 */
import { requireIn } from "@/lib/generation/authz";
import { MAX_RECORDING_BYTES } from "@/lib/recordings/match";
import { commitRecording, listRecordings, removeRecording } from "@/lib/recordings/store";
import { recordingTarget } from "@/lib/recordings/target";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "record");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const { target, denied: bad } = await recordingTarget(params.get("source"), params.get("file"), lang);
  if (bad) return bad;

  return Response.json({ recordings: await listRecordings(target.source, lang, target.file) });
}

export async function POST(request: Request) {
  const { lang, session, denied } = await requireIn(request, "record");
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Also what a body larger than the proxy allows looks like from here.
    return Response.json({ error: "could not read the upload" }, { status: 400 });
  }
  const { target, denied: bad } = await recordingTarget(form.get("source"), form.get("file"), lang);
  if (bad) return bad;

  // The credit is what the pack prints, in its TOC and its Lua, for anybody who downloads it.
  // So it is the name somebody chose to be shown under, and never the email address an
  // account without one would fall back to.
  const credit = session.user.name?.trim();
  if (!credit) {
    return Response.json(
      { error: "Set a display name in your profile first: it is what the pack credits you as" },
      { status: 422 },
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "no audio was uploaded" }, { status: 400 });
  }
  if (audio.size > MAX_RECORDING_BYTES) {
    return Response.json(
      { error: `${audio.name} is over ${MAX_RECORDING_BYTES / 1024 / 1024} MiB` },
      { status: 413 },
    );
  }

  const result = await commitRecording({
    source: target.source,
    lang,
    file: target.file,
    // The file's own line, from the whitelist, rather than anything the caller says: the places
    // overlay is keyed by it, and a line id that is not this file's would put the clip under
    // another place or fail the pack build.
    lineId: target.lineId,
    data: Buffer.from(await audio.arrayBuffer()),
    originalName: audio.name || null,
    credit,
    createdBy: session.user.id,
  });
  if ("error" in result) {
    return Response.json({ error: `${audio.name || "the file"} ${result.error}` }, { status: 422 });
  }
  return Response.json(result, { status: 201 });
}

export async function DELETE(request: Request) {
  const { lang, session, denied } = await requireIn(request, "record");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const { target, denied: bad } = await recordingTarget(params.get("source"), params.get("file"), lang);
  if (bad) return bad;
  const version = Number(params.get("version"));
  if (!Number.isInteger(version) || version < 1) return new Response("bad version", { status: 400 });

  const removed = await removeRecording({
    source: target.source,
    lang,
    file: target.file,
    version,
    by: session.user.id,
    mayRemoveAny: session.user.role === "admin",
  });
  if (!removed) return new Response("no such recording of yours", { status: 404 });
  return new Response(null, { status: 204 });
}
