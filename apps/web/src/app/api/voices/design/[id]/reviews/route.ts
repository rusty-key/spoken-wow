/** A verdict on a version. Spends nothing; anyone who designs in the language may give one. */
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { parseReview } from "@/lib/voice-design/review";
import { addReview, readDesign } from "@/lib/voice-design/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  try {
    const design = await readDesign(lang, id);
    if (!design) return Response.json({ error: "no such design" }, { status: 404 });
    await addReview(lang, id, parseReview(await request.json().catch(() => null), design, session.user.id));
    return Response.json({ design: await readDesign(lang, id) });
  } catch (error) {
    return failed(error);
  }
}
