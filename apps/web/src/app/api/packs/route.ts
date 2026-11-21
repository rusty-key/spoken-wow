import { bodyOf } from "@/lib/api-body";
import { asMember } from "@/lib/community/guard";
import { createPack, listOwned } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export const GET = () => asMember(async (userId) => Response.json({ packs: await listOwned(userId) }));

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return asMember(async (userId) => Response.json(await createPack(userId, body)));
}
