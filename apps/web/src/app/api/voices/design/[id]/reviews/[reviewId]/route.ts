/** Removes a verdict given by mistake. Spends nothing; anyone who designs in the language may. */
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { readDesign, removeReview } from "@/lib/voice-design/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; reviewId: string }> };

export async function DELETE(request: Request, context: Context) {
  const { id, reviewId } = await context.params;
  const { lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  try {
    const review = Number(reviewId);
    if (!Number.isSafeInteger(review) || !(await readDesign(lang, id)) || !(await removeReview(lang, id, review))) {
      return Response.json({ error: "no such verdict" }, { status: 404 });
    }
    return Response.json({ design: await readDesign(lang, id) });
  } catch (error) {
    return failed(error);
  }
}
