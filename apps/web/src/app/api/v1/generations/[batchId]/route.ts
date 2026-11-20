import { ownGeneration } from "@/lib/generation/batch-status";
import { withToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withToken(request, { need: "generate", noQuery: true }, async (context) => {
    const { batchId } = await params;
    const batch = await ownGeneration(context, batchId);
    return batch instanceof Response ? batch : Response.json(batch);
  });
}
