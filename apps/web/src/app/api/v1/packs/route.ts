/** /api/packs for a script, with a packs token where that has a session. */
import { bodyOf } from "@/lib/api-body";
import { asPacksToken } from "@/lib/community/guard";
import { createPack, listOwned } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  asPacksToken(request, async (userId) => Response.json({ packs: await listOwned(userId) }));

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return asPacksToken(request, async (userId) => Response.json(await createPack(userId, body)));
}
