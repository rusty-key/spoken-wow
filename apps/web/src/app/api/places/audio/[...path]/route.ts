/**
 * A places line's live take: /api/places/audio/1411/razor-hill.mp3.
 *
 * The guard is membership in the set of paths the catalogue can address, which is
 * traversal-proof by construction: a path either names a file some line owns or it does
 * not exist, and no amount of "../" produces a member of that set. Which take plays is the
 * row's `isCurrent`; the bytes are that take's archived file.
 */
import { langParam } from "@/lib/lang-server";
import { isAddressable } from "@/lib/places/audio";
import { serveTake } from "@/lib/takes/serve";
import { livePath } from "@/lib/takes/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const rel = (await context.params).path.join("/");
  if (!(await isAddressable(rel))) return new Response("bad audio path", { status: 400 });
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  return serveTake(request, await livePath("places", rel.slice(0, -".mp3".length), lang), {
    immutable: false,
    lang,
  });
}
