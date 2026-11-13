import { ownGeneration } from "@/lib/generation/batch-status";
import { requireToken } from "@/lib/text-api/guard";
import { noQuery } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate" });
  if (denied) return denied;
  const refused = noQuery(request);
  if (refused) return refused;

  const batch = await ownGeneration(context, (await params).batchId);
  return batch instanceof Response ? batch : Response.json(batch);
}
