/**
 * Playing an archived take, in whichever section owns it:
 * /api/takes/audio?source=zones&file=1411/razor-hill&version=2
 *
 * The point of a history is hearing the alternative before committing to it, so this is
 * what makes "restore" a decision rather than a gamble. Quests had it and the other two did
 * not, which is half the reason their history was never worth showing.
 *
 * Query parameters rather than path segments, because the three sections name files by
 * different frozen rules and two of them are nested paths: reassembling one out of segments
 * is how a traversal bug gets written. The file is whitelisted against the section's own
 * addressable set either way, and the archived name is resolved from the take rather than
 * taken from the caller -- there is no string here that a request can steer at another
 * directory.
 *
 * Deliberately simpler than the live audio routes. A take never changes once written -- a
 * new take gets a new number, and nothing renames or deletes one -- so it is cached
 * immutably with no ETag dance. That holds for the live take too: restoring an earlier one
 * moves the flag to a different version, which is a different URL.
 *
 * Behind regenerate, unlike the live audio: a signed-out visitor has no business
 * enumerating takes that were rejected.
 */
import { NextRequest } from "next/server";

import { requireIn } from "@/lib/generation/authz";
import { serveTake } from "@/lib/takes/serve";
import { isAddressableFile } from "@/lib/takes/files";
import { takePath } from "@/lib/takes/store";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const source = params.get("source");
  const file = params.get("file");
  const version = Number(params.get("version"));

  if (!isSource(source) || !file || !Number.isInteger(version) || version < 1) {
    return new Response("bad take", { status: 400 });
  }
  if (!(await isAddressableFile(source, file, lang))) {
    return new Response("unknown file", { status: 404 });
  }

  return serveTake(request, await takePath(source, file, version, lang), { immutable: true, lang });
}
