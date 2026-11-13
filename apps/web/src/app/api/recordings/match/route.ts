/**
 * Which line each of a folder's worth of files records, before any of them is sent:
 * POST /api/recordings/match?lang=deDE  { source, names: ["1411-razor-hill.ogg", ...] }
 *
 * The drop zone asks first so that the actor sees what will land where, and what will not
 * land at all, before uploading a session's worth of audio. The rule is recordings/match.ts;
 * the list of files it matches against is the language's own.
 */
import { requireIn } from "@/lib/generation/authz";
import { matchUploads } from "@/lib/recordings/match";
import { recordableFiles } from "@/lib/recordings/store";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

/** A session is a few hundred lines; this is only a bound on a runaway request. */
const MAX_NAMES = 5000;

export async function POST(request: Request) {
  const { lang, denied } = await requireIn(request, "record");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { source?: unknown; names?: unknown } | null;
  const names = body?.names;
  if (
    !body ||
    !isSource(body.source) ||
    !Array.isArray(names) ||
    names.length > MAX_NAMES ||
    !names.every((name) => typeof name === "string")
  ) {
    return new Response("bad match request", { status: 400 });
  }

  const files = await recordableFiles(body.source, lang);
  return Response.json({ matches: matchUploads(body.source, names, files.keys()) });
}
