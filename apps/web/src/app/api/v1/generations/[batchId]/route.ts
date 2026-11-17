import { ownGeneration } from "@/lib/generation/batch-status";
import { asActor } from "@/lib/teams/acting";
import { requireToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate", teams: true, noQuery: true });
  if (denied) return denied;

  const { batchId } = await params;
  return asActor(context.userId, async () => {
    const batch = await ownGeneration(context, batchId);
    return batch instanceof Response ? batch : Response.json(batch);
  });
}
