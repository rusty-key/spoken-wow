/**
 * A boss story's live take: /api/bosses/audio/36/edwin-vancleef.mp3.
 *
 * The guard is membership in the set of paths the catalogue addresses, which no amount of
 * "../" can produce a member of. A path no boss owns is a 404: there is nothing at it.
 * `?team=<slug>` plays another team's live take, and nothing of a file it has none of.
 */
import { langParam } from "@/lib/lang-server";
import { isAddressable } from "@/lib/bosses/audio";
import { serveViewed } from "@/lib/teams/viewing";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const rel = (await context.params).path.join("/");
  if (!(await isAddressable(rel))) return new Response("no such boss audio", { status: 404 });
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  return serveViewed(request, "bosses", rel.slice(0, -".mp3".length), lang);
}
