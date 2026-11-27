/** Hide a player's note as spam. Its verdict still counts. */
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { readDesign } from "@/lib/voice-design/store";
import { hideNote } from "@/lib/voice-feedback/showings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const { lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { showingId?: unknown; voter?: unknown } | null;
  if (typeof body?.showingId !== "number" || typeof body.voter !== "string") {
    return Response.json({ error: "showingId and voter are required" }, { status: 400 });
  }
  try {
    const design = await readDesign(lang, id);
    if (!design?.showings.some((showing) => showing.id === body.showingId)) {
      return Response.json({ error: "no such note" }, { status: 404 });
    }
    if (!(await hideNote(lang, body.showingId, body.voter))) return Response.json({ error: "no such note" }, { status: 404 });
    return Response.json({ design: await readDesign(lang, id) });
  } catch (error) {
    return failed(error);
  }
}
