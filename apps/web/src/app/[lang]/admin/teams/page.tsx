import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import TeamsTable from "@/components/TeamsTable";
import { Wide } from "@/components/Width";
import { CODES, BASE_LANG, langName } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { listTeams, liveTakeCounts } from "@/lib/teams/admin";

export const metadata: Metadata = { title: "Teams · Spoken" };

export const dynamic = "force-dynamic";

/** Site admins only; everyone else gets a 404. */
export default async function Page() {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();

  const [teams, live] = await Promise.all([listTeams(), liveTakeCounts()]);
  const counts = teams.flatMap((team) => team.langs).map((lang) => [lang, live.get(lang) ?? 0] as const);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={CODES}
        global
        tab="teams"
        description="A team owns its languages' takes, voices and settings, and the people who regenerate them. Handing a language over moves all of it, and is refused while one of its jobs is running."
      />
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
