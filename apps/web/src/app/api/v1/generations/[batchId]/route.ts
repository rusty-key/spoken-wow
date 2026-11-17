import { ownGeneration } from "@/lib/generation/batch-status";
import { requireToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate", noQuery: true });
  if (denied) return denied;

  const batch = await ownGeneration(context, (await params).batchId);
  return batch instanceof Response ? batch : Response.json(batch);
}
