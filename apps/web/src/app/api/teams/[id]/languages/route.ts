import { isLang } from "@/lib/lang";
import { handOver } from "@/lib/teams/admin";

import { bad, bodyOf, isTeamId, refusal, siteAdmin } from "../../guard";

export const dynamic = "force-dynamic";

/** Hands `lang`, and every row of it, to the team. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await siteAdmin();
  if ("denied" in who) return who.denied;

  const { id } = await params;
  const { lang } = await bodyOf(request);
  if (!isTeamId(id)) return bad("No such team.");
  if (!isLang(lang)) return bad("expected { lang }");
  try {
    return Response.json({ moved: await handOver(lang, id, who.userId) });
  } catch (error) {
    return refusal(error);
  }
}
