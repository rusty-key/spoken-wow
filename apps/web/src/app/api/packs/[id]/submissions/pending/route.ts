import { asAuthor } from "@/lib/community/guard";
import { withdrawPending } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return asAuthor(async (userId) => {
    await withdrawPending(userId, id);
    return Response.json({ ok: true });
  });
}
