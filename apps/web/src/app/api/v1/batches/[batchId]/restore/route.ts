/**
 * Undoes a mass update, as far as nobody has edited its lines since. The owner may, whichever of
 * their tokens asks, and so may a global admin, but only with a token in the batch's language.
 */
import { isAdmin } from "@/lib/permissions";
import { getBatch, restoreBatch } from "@/lib/text-api/batches";
import { requireToken } from "@/lib/text-api/guard";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { context, denied } = await requireToken(request, { need: "write" });
  if (denied) return denied;

  const { batchId } = await params;
  const batch = isUuid(batchId) ? await getBatch(batchId) : null;
  if (!batch) return Response.json({ error: "no such batch" }, { status: 404 });

  if (batch.userId !== context.userId && !isAdmin(context.role)) {
    return Response.json({ error: "this batch is someone else's" }, { status: 403 });
  }
  if (batch.lang !== context.lang) {
    return Response.json({ error: `this batch is in ${batch.lang}; use a token for that language` }, { status: 403 });
  }

  return Response.json({ results: await restoreBatch(batch, context.userId) });
}
