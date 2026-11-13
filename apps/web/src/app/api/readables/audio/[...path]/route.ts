/**
 * A book page's live take: /api/readables/audio/1381.mp3.
 *
 * The places route's shape and guard: membership in the set of paths the corpus can
 * address, traversal-proof by construction. Which take plays is the row's `isCurrent`;
 * the bytes are that take's archived file.
 */
import { isAddressable } from "@/lib/readables/audio";
import { langParam } from "@/lib/lang-server";
import { serveTake } from "@/lib/takes/serve";
import { livePath } from "@/lib/takes/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const rel = (await context.params).path.join("/");
  // Addressable in English: a page's file name is its id, the same in every language, and
  // English is the corpus every page exists in. Asked beside the language, not after it.
  const [{ lang, denied }, addressable] = await Promise.all([
    langParam(request),
    isAddressable(rel),
  ]);
  if (denied) return denied;
  if (!addressable) return new Response("bad audio path", { status: 400 });
  return serveTake(request, await livePath("readables", rel.slice(0, -".mp3".length), lang), {
    immutable: false,
    lang,
  });
}
