/** The token owner's recent batches in the token's language, whichever surface queued them. */
import { listOwnBatches } from "@/lib/generation/batch-status";
import { withToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withToken(request, { need: "generate", noQuery: true }, async (context) =>
    Response.json({ batches: await listOwnBatches(context.userId, context.lang) }),
  );
}
