/** The API's counterpart of the panel's Stop: cancels the batch's pending jobs, nothing else. */
import { ownBatch } from "@/lib/generation/batch-status";
import { cancelPending } from "@/lib/generation/queue";
import { requireToken } from "@/lib/text-api/guard";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate" });
  if (denied) return denied;

  const { batchId } = await params;
  const batch = isUuid(batchId) ? await ownBatch(batchId, context.userId, context.lang) : null;
  if (!batch) return Response.json({ error: "no such generation" }, { status: 404 });

  const cancelled = await cancelPending("Stopped through the API", {
    batchId,
    langs: [context.lang],
    by: context.userId,
  });
  return Response.json({ cancelled });
}
