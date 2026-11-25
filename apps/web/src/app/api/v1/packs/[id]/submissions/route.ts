import { bodyOf } from "@/lib/api-body";
import { asPacksToken } from "@/lib/community/guard";
import { submitVersion } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, body] = await Promise.all([params, bodyOf(request)]);
  return asPacksToken(request, async (userId) => Response.json(await submitVersion(userId, id, body)));
}
