/** Site owners only. */
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { createTeamWithLangs, listTeams } from "@/lib/teams/admin";

import { bad, bodyOf, withAdmin } from "./guard";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => Response.json({ teams: await listTeams() }));

export const POST = withAdmin(async (request, actorId) => {
  const { slug, name, langs, adminEmail } = await bodyOf(request);
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
