import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TeamsTable from "@/components/TeamsTable";
import { Contained, Wide } from "@/components/Width";
import { CODES, BASE_LANG, langName } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { listTeams, liveTakeCount } from "@/lib/teams/admin";

export const metadata: Metadata = { title: "Teams · Spoken" };

export const dynamic = "force-dynamic";

/** Who owns which language, for site admins only; a 404 for everyone else, as the users page. */
export default async function Page() {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();

  const teams = await listTeams();
  const held = teams.flatMap((team) => team.langs);
  const counts = await Promise.all(held.map(async (lang) => [lang, await liveTakeCount(lang)] as const));

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Teams</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          A team owns its languages&apos; takes, voices and settings, and the people who regenerate
          them. Handing a language over moves all of it, and is refused while one of its jobs is
          running.
        </p>
      </Contained>
      <Wide>
        <TeamsTable
          initial={teams}
          takes={Object.fromEntries(counts)}
          languages={CODES.filter((code) => code !== BASE_LANG).map((code) => ({ code, name: langName(code) }))}
        />
      </Wide>
    </main>
  );
}
