import { knownLang } from "@/lib/languages/catalogue";
import { handOver } from "@/lib/teams/admin";

import { bad, bodyOf, withAdmin } from "../../guard";

export const dynamic = "force-dynamic";

export const PUT = withAdmin(async (request, actorId, team) => {
  const lang = await knownLang((await bodyOf(request)).lang);
  if (!lang) return bad("expected { lang }");
  return Response.json({ moved: await handOver(lang, team, actorId) });
}, "id");
