/**
 * A site owner's choice of the team they act inside in a language, kept in the acting cookie.
 *
 * No origin check, as on the site's other session routes: the session cookie is SameSite=Lax,
 * so a POST from another site arrives signed out and is refused.
 */
import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { requireAdminSession } from "@/lib/generation/authz";
import type { Lang } from "@/lib/lang";
import { teamIn } from "@/lib/teams/acting";
import { actingCookie, currentChoice } from "@/lib/teams/acting-cookie";
import { teamsVoicing, unknownTeam } from "@/lib/teams/viewing";

export const dynamic = "force-dynamic";

/**
 * `{ lang, team }`: `team` a slug of a team voicing `lang`, or null. The privileged team, or
 * null, removes `lang`'s entry. Answers the slug kept, and `home`: the team the site owner now
 * acts as there, which the picker names by leaving `team` out of the address.
 */
export async function POST(request: Request) {
  const { session, denied } = await requireAdminSession();
  if (denied) return denied;
  const body = objectOf(await bodyOf(request));
  const lang = body?.lang;
  const slug = body?.team;
  if (typeof lang !== "string" || (slug !== null && typeof slug !== "string")) {
    return bad("expected { lang, team: slug or null }");
  }

  // Empty for a language with one team: there is no other team to act inside.
  const teams = await teamsVoicing(lang as Lang);
  const picked = slug === null ? null : teams.find((team) => team.slug === slug);
  if (picked === undefined) return unknownTeam(slug as string, lang as Lang);

  const choice = await currentChoice();
  const kept = picked && !picked.privileged ? picked : null;
  if (kept) choice[lang] = kept.slug;
  else delete choice[lang];

  const member = kept ? null : await teamIn(session.user.id, lang);
  const home = kept ?? teams.find((team) => team.id === member) ?? teams.find((team) => team.privileged);
  return Response.json(
    { team: kept?.slug ?? null, home: home?.slug ?? null },
    { headers: { "Set-Cookie": actingCookie(choice) } },
  );
}
