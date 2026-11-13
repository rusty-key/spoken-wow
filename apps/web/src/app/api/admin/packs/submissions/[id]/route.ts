import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { asAdmin } from "@/lib/community/guard";
import { decide } from "@/lib/community/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, body] = await Promise.all([params, bodyOf(request)]);
  const { decision, reason } = objectOf(body) ?? {};
  if (decision !== "approve" && decision !== "reject") return bad('expected { decision: "approve" | "reject", reason? }');
  if (reason !== undefined && reason !== null && typeof reason !== "string") return bad("reason is text.");
  return asAdmin(async (adminId) => Response.json(await decide(adminId, id, decision, reason ?? undefined)));
}
