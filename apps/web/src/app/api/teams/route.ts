/** Site owners only. */
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { ALL_TEAMS, withTeam } from "@/lib/db";
import { userByEmail } from "@/lib/grants/store";
import { loadLanguages } from "@/lib/languages/catalogue";
import { describedName, newLanguageError } from "@/lib/languages/validate";
import { createTeamWithLangs, listTeams, SLUG, TeamError } from "@/lib/teams/admin";
import { afterFounded, foundTeam } from "@/lib/teams/found";

import { bad, bodyOf, withAdmin } from "./guard";
import { objectOf } from "@/lib/api-body";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => Response.json({ teams: await listTeams() }));

export const POST = withAdmin(async (request, actorId) => {
  const { slug, name, langs, adminEmail, newLanguage } = await bodyOf(request);
  if (newLanguage !== undefined && newLanguage !== null) {
    if (Array.isArray(langs) && langs.length) return bad("Give either langs or newLanguage, not both.");
    return foundNew(slug, name, adminEmail, newLanguage, actorId);
  }
  if (typeof slug !== "string" || typeof name !== "string" || !Array.isArray(langs) || !langs.every(isLang)) {
    return bad("expected { slug, name, langs: [...], adminEmail? }");
  }
  if (!name.trim()) return bad("A team needs a name.");
  if (langs.includes(BASE_LANG)) return bad("English stays with its own team.");
  if (adminEmail !== undefined && adminEmail !== null && typeof adminEmail !== "string") {
    return bad("adminEmail is an email address.");
  }
  const email = typeof adminEmail === "string" && adminEmail.trim() ? adminEmail.trim() : null;
  // A language named twice would be refused the second time, as already the team's.
  const given = [...new Set(langs as Lang[])];
  // The admin is granted per language, so with none they would be granted nothing.
  if (email && !given.length) return bad("An admin needs a language to admin.");

  const { team } = await createTeamWithLangs({ slug, name: name.trim(), adminEmail: email, langs: given }, actorId);
  return Response.json({ team });
});

/** A team for a language the site does not know yet, made by the step approval runs. */
async function foundNew(
  slug: unknown,
  name: unknown,
  adminEmail: unknown,
  newLanguage: unknown,
  actorId: string,
): Promise<Response> {
  if (typeof slug !== "string" || typeof name !== "string") return bad("expected { slug, name, newLanguage, adminEmail? }");
  if (!SLUG.test(slug)) return bad("A team's slug is lowercase letters, digits and dashes, starting with a letter.");
  const teamName = describedName(name);
  if (!teamName) return bad("A team needs a name of 1 to 60 characters.");
  if (adminEmail !== undefined && adminEmail !== null && typeof adminEmail !== "string") {
    return bad("adminEmail is an email address.");
  }
  const given = objectOf(newLanguage);
  const code = given?.code;
  if (typeof code !== "string") return bad("newLanguage is { code, name, native }.");
  const problem = newLanguageError(code, given?.name, given?.native);
  if (problem) return bad(problem);
  await loadLanguages();
  if (isLang(code)) throw new TeamError(`${code} is already a language.`, 409);

  const email = typeof adminEmail === "string" && adminEmail.trim() ? adminEmail.trim() : null;
  let adminId: string | null = null;
  if (email) {
    const admin = await userByEmail(email);
    if (!admin) return bad(`No user has the email ${email}.`);
    adminId = admin.id;
  }

  const founded = await withTeam(ALL_TEAMS, (client) =>
    foundTeam(
      client,
      {
        lang: code,
        language: { name: describedName(given?.name)!, native: describedName(given?.native)! },
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
