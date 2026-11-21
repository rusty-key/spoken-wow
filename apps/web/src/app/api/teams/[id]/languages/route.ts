import { knownLang } from "@/lib/languages/catalogue";
import { addToLanguage } from "@/lib/teams/admin";

import { bad, bodyOf, withAdmin } from "../../guard";

export const dynamic = "force-dynamic";

/** `{ lang }`: the team voices `lang` beside its other teams. */
export const PUT = withAdmin(async (request, actorId, team) => {
  const lang = await knownLang((await bodyOf(request)).lang);
  if (!lang) return bad("expected { lang }");
  await addToLanguage(lang, team, actorId);
  return Response.json({ ok: true });
}, "id");
