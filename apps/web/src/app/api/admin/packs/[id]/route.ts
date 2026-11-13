import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { asAdmin } from "@/lib/community/guard";
import { setListed, setOwner } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, body] = await Promise.all([params, bodyOf(request)]);
  const { ownerId, listed } = objectOf(body) ?? {};
  if (ownerId === undefined && listed === undefined) return bad("expected { ownerId?, listed? }");
  if (ownerId !== undefined && ownerId !== null && typeof ownerId !== "string") return bad("ownerId is a user id or null.");
  if (listed !== undefined && typeof listed !== "boolean") return bad("listed is true or false.");
  return asAdmin(async (adminId) => {
    let pack;
    if (ownerId !== undefined) pack = await setOwner(adminId, id, ownerId);
    if (listed !== undefined) pack = await setListed(adminId, id, listed);
    return Response.json(pack);
  });
}
