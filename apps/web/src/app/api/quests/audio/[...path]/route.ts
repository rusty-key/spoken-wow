/**
 * A quests line's live take: /api/quests/audio/gossip/31ab….mp3.
 *
 * The path is the one the addon resolves, so a URL stays meaningful across regenerations;
 * which take it plays is the row's `isCurrent`, and the bytes are that take's archived
 * file. Checked against a whitelist shape rather than sanitised. `?team=<slug>` plays another
 * team's live take instead, and nothing of a file it has none of.
 */
import { NextRequest } from "next/server";

import { langParam } from "@/lib/lang-server";
import { isSafeAudioPath } from "@/lib/range";
import { serveViewed } from "@/lib/teams/viewing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const file = (await context.params).path.join("/");
  if (!isSafeAudioPath(file)) return new Response("bad audio path", { status: 400 });
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  return serveViewed(request, "quests", file, lang);
}
