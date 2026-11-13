import { ownBatch } from "@/lib/generation/batch-status";
import { requireToken } from "@/lib/text-api/guard";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate" });
  if (denied) return denied;

  const { batchId } = await params;
  const batch = isUuid(batchId) ? await ownBatch(batchId, context.userId, context.lang) : null;
  if (!batch) return Response.json({ error: "no such generation" }, { status: 404 });
  return Response.json(batch);
}
