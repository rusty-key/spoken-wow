/** Site owners only. */
import { objectOf } from "@/lib/api-body";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { ALL_TEAMS, withTeam } from "@/lib/db";
import { loadLanguages } from "@/lib/languages/catalogue";
import { checkNewLanguage, describedName } from "@/lib/languages/validate";
import { checkSlug, createTeamWithLangs, listTeams, resolveAdmin, TeamError } from "@/lib/teams/admin";
import { afterFounded, foundTeam } from "@/lib/teams/found";

import { bad, bodyOf, withAdmin } from "./guard";
export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => Response.json({ teams: await listTeams() }));

export const POST = withAdmin(async (request, actorId) => {
  const { slug, name, langs, adminEmail, newLanguage } = await bodyOf(request);
  if (newLanguage !== undefined && newLanguage !== null) {
    if (Array.isArray(langs) && langs.length) return bad("Give either langs or newLanguage, not both.");
    return foundNew(slug, name, adminEmail, newLanguage, actorId);
  }
  // So a language the other worker created is known here.
  await loadLanguages();
  if (typeof slug !== "string" || typeof name !== "string" || !Array.isArray(langs) || !langs.every(isLang)) {
    return bad("expected { slug, name, langs: [...], adminEmail? }");
  }
  if (!name.trim()) return bad("A team needs a name.");
  if (langs.includes(BASE_LANG)) return bad("English stays with its own team.");
  const email = adminEmailOf(adminEmail);
  if (email === undefined) return bad("adminEmail is an email address.");
  // A language named twice would be refused the second time, as already the team's.
  const given = [...new Set(langs as Lang[])];
  // The admin is granted per language, so with none they would be granted nothing.
  if (email && !given.length) return bad("An admin needs a language to admin.");

  const { team } = await createTeamWithLangs({ slug, name: name.trim(), adminEmail: email, langs: given }, actorId);
  return Response.json({ team });
});

/** The trimmed address, null for none, undefined for a value that is not text. */
function adminEmailOf(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

/** A team for a language the site does not know yet, made by the step approval runs. */
async function foundNew(
  slug: unknown,
  name: unknown,
  adminEmail: unknown,
  newLanguage: unknown,
  actorId: string,
): Promise<Response> {
  if (typeof slug !== "string" || typeof name !== "string") return bad("expected { slug, name, newLanguage, adminEmail? }");
  checkSlug(slug);
  const teamName = describedName(name);
  if (!teamName) return bad("A team needs a name of 1 to 60 characters.");
  const email = adminEmailOf(adminEmail);
  if (email === undefined) return bad("adminEmail is an email address.");
  const given = objectOf(newLanguage);
  const code = given?.code;
  if (typeof code !== "string") return bad("newLanguage is { code, name, native }.");
  const checked = checkNewLanguage(code, given?.name, given?.native);
  if ("error" in checked) return bad(checked.error);
  await loadLanguages();
  if (isLang(code)) throw new TeamError(`${code} is already a language.`, 409);

  const adminId = await resolveAdmin(email);

  const founded = await withTeam(ALL_TEAMS, (client) =>
    foundTeam(
      client,
      {
        lang: code,
        language: checked.language,
        team: { slug, name: teamName },
        adminId,
      },
      actorId,
    ),
  );
  await afterFounded(founded, actorId);
  const [team] = await listTeams(founded.teamId);
  return Response.json({ team });
}
