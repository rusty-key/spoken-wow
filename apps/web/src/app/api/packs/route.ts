/** The signed-in pack author's own packs, and a new pack for approval. */
import { asAuthor, bodyOf } from "@/lib/community/guard";
import { createPack, listOwned } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export const GET = () => asAuthor(async (userId) => Response.json({ packs: await listOwned(userId) }));

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return asAuthor(async (userId) => Response.json(await createPack(userId, body)));
}
