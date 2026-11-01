/**
 * Teams, for site owners only: the list, and a new team with the languages it starts with.
 */
import { addGrants, userByEmail } from "@/lib/grants/store";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { createTeam, handOver, listTeams, TeamBusyError, TeamInputError } from "@/lib/teams/admin";

import { bad, bodyOf, refusal, siteAdmin } from "./guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const who = await siteAdmin();
  if ("denied" in who) return who.denied;
  return Response.json({ teams: await listTeams() });
}

export async function POST(request: Request) {
  const who = await siteAdmin();
  if ("denied" in who) return who.denied;

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

  try {
    const team = await createTeam({ slug, name: name.trim(), adminEmail: email }, who.userId);
    const admin = email ? await userByEmail(email) : null;
    const moved: Lang[] = [];
    for (const lang of langs as Lang[]) {
      try {
        await handOver(lang, team, who.userId);
        moved.push(lang);
        if (admin) await addGrants(admin.id, lang, ["admin"], who.userId);
      } catch (error) {
        // The team and what already moved stay, which the message has to say.
        const done = moved.length ? `moved ${moved.join(", ")}; ` : "";
        const said = `${done}${lang} ${moved.includes(lang) ? "granted nothing" : "refused"}: `;
        if (error instanceof TeamBusyError || error instanceof TeamInputError) return refusal(error, said);
        return Response.json({ error: said + (error instanceof Error ? error.message : String(error)) }, { status: 500 });
      }
    }
    const created = (await listTeams()).find((row) => row.id === team);
    return Response.json({ team: created });
  } catch (error) {
    return refusal(error);
  }
}
