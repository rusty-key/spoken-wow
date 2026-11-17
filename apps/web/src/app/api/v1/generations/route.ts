/** The token owner's recent batches in the token's language, whichever surface queued them. */
import { listOwnBatches } from "@/lib/generation/batch-status";
import { asActor } from "@/lib/teams/acting";
import { requireToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { context, denied } = await requireToken(request, { need: "generate", teams: true, noQuery: true });
  if (denied) return denied;
  return asActor(context.userId, async () =>
    Response.json({ batches: await listOwnBatches(context.userId, context.lang) }),
  );
}
