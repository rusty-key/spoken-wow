/**
 * Undoes a mass update, as far as nobody has edited its lines since. The owner may, whichever of
 * their tokens asks, and so may a global admin, but only with a token in the batch's language.
 * Each edit is undone only in a layer the token's owner may write now.
 */
import { isAdmin } from "@/lib/permissions";
import { getBatch, restoreBatch } from "@/lib/text-api/batches";
import { withToken } from "@/lib/text-api/guard";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withToken(request, { need: "write" }, async (context) => {
    const { batchId } = await params;
    const batch = isUuid(batchId) ? await getBatch(batchId) : null;
    if (!batch) return Response.json({ error: "no such batch" }, { status: 404 });

    if (batch.userId !== context.userId && !isAdmin(context.role)) {
      return Response.json({ error: "this batch is someone else's" }, { status: 403 });
    }
    if (batch.lang !== context.lang) {
      return Response.json({ error: `this batch is in ${batch.lang}; use a token for that language` }, { status: 403 });
    }

    const restorer = { by: context.userId, layers: context.layers, admin: isAdmin(context.role) };
    return Response.json({ results: await restoreBatch(batch, restorer) });
  });
}
