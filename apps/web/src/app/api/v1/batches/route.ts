/**
 * The token owner's recent mass updates in its language. A run's id is first given in the response
 * to that run, and a run cut off partway never sends one, so this is how such a run is found.
 */
import { listBatches } from "@/lib/text-api/batches";
import { requireToken } from "@/lib/text-api/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { context, denied } = await requireToken(request);
  if (denied) return denied;
  const batches = await listBatches(context.userId, context.lang);
  return Response.json({
    batches: batches.map(({ userId: _userId, lang: _lang, ...batch }) => batch),
  });
}
