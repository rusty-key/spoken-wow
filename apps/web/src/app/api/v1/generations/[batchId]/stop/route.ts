/** The API's counterpart of the panel's Stop: cancels the batch's pending jobs, nothing else. */
import { ownGeneration } from "@/lib/generation/batch-status";
import { cancelPending } from "@/lib/generation/queue";
import { requireToken } from "@/lib/text-api/guard";
import { noQuery } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate" });
  if (denied) return denied;
  const refused = noQuery(request);
  if (refused) return refused;

  const { batchId } = await params;
  const batch = await ownGeneration(context, batchId, { failures: false });
  if (batch instanceof Response) return batch;

  const cancelled = await cancelPending("Stopped through the API", {
    batchId,
    langs: [context.lang],
    by: context.userId,
  });
  return Response.json({ cancelled });
}
