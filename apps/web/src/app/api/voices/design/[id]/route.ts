/** Deletes the slot's newest version while none of its previews is saved, so the one before is current again. */
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { deleteUnsavedVersion } from "@/lib/voice-design/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const { lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  try {
    await deleteUnsavedVersion(lang, id);
    return Response.json({ deleted: id });
  } catch (error) {
    return failed(error);
  }
}
