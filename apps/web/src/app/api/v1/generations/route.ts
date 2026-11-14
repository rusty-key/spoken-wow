/** The token owner's recent batches in the token's language, whichever surface queued them. */
import { listOwnBatches } from "@/lib/generation/batch-status";
import { requireToken } from "@/lib/text-api/guard";
import { noQuery } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { context, denied } = await requireToken(request, { need: "generate" });
  if (denied) return denied;
  const refused = noQuery(request);
  if (refused) return refused;
  return Response.json({ batches: await listOwnBatches(context.userId, context.lang) });
}
