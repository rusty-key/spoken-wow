/** The token owner's recent batches in the token's language, whichever surface queued them. */
import { listOwnBatches } from "@/lib/generation/batch-status";
import { requireToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { context, denied } = await requireToken(request, { need: "generate" });
  if (denied) return denied;
  if (new URL(request.url).search) return Response.json({ error: "this takes no query string" }, { status: 400 });
  return Response.json({ batches: await listOwnBatches(context.userId, context.lang) });
}
