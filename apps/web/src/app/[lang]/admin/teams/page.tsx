import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import TeamRequests from "@/components/TeamRequests";
import TeamsTable from "@/components/TeamsTable";
import { Wide } from "@/components/Width";
import { allLangs, languageOptions } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { listTeams, liveTakeCounts } from "@/lib/teams/admin";
import { listRequests } from "@/lib/teams/requests";

export const metadata: Metadata = { title: "Teams · Spoken" };

export const dynamic = "force-dynamic";

/** Site admins only; everyone else gets a 404. */
export default async function Page() {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();

  const [teams, live, requests] = await Promise.all([
    listTeams(),
    liveTakeCounts(),
    listRequests({ state: "pending" }),
  ]);
  const counts = teams.flatMap((team) => team.langs).map((lang) => [lang, live.get(lang) ?? 0] as const);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={allLangs()}
        global
        tab="teams"
        description="A team owns its languages' takes, voices and settings, and the people who regenerate them. Handing a language over moves all of it, and is refused while one of its jobs is running."
      />
      <Wide>
        <TeamRequests initial={requests} />
        <TeamsTable
          initial={teams}
          takes={Object.fromEntries(counts)}
          languages={languageOptions()}
        />
      </Wide>
    </main>
  );
}
