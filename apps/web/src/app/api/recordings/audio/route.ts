/**
 * Playing one recording: /api/recordings/audio?lang=deDE&source=places&file=1411/razor-hill&version=2
 *
 * Shaped like /api/takes/audio and answered by the same serveTake: query parameters, a
 * whitelisted file, the archived name read from the row and never from the caller, and an
 * immutable answer, since a version's bytes never change. A removed recording still plays, so
 * its history can be heard.
 *
 * Behind `record`, like everything else about recordings, and cached privately for the same
 * reason (the `recordings/` prefix): nothing an actor uploaded is public until it ships in a pack.
 */
import { requireIn } from "@/lib/generation/authz";
import { recordingPath } from "@/lib/recordings/store";
import { recordingTarget } from "@/lib/recordings/target";
import { serveTake } from "@/lib/takes/serve";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "record");
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const { target, denied: bad } = await recordingTarget(params.get("source"), params.get("file"), lang);
  if (bad) return bad;
  const version = Number(params.get("version"));
  if (!Number.isInteger(version) || version < 1) return new Response("bad version", { status: 400 });

  return serveTake(request, await recordingPath(target.source, lang, target.file, version), { immutable: true, lang });
}
