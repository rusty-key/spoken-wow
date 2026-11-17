/** The API's counterpart of the panel's Stop: cancels the batch's pending jobs, nothing else. */
import { notOwnGeneration } from "@/lib/generation/batch-status";
import { cancelPending } from "@/lib/generation/queue";
import { requireToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate", noQuery: true });
  if (denied) return denied;

  const { batchId } = await params;
  const missing = await notOwnGeneration(context, batchId);
  if (missing) return missing;

  const cancelled = await cancelPending("Stopped through the API", {
    batchId,
    langs: [context.lang],
    by: context.userId,
  });
  return Response.json({ cancelled });
}
