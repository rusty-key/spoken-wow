import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import TeamRequests from "@/components/TeamRequests";
import TeamsTable from "@/components/TeamsTable";
import { Wide } from "@/components/Width";
import { allLangs, languageOptions, type Lang } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { listTeams } from "@/lib/teams/admin";
import { listRequests } from "@/lib/teams/requests";
import { teamsOf } from "@/lib/teams/store";

export const metadata: Metadata = { title: "Teams · Spoken" };

export const dynamic = "force-dynamic";

/** Site admins only; everyone else gets a 404. */
export default async function Page() {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();

  const [teams, requests] = await Promise.all([listTeams(), listRequests({ state: "pending" })]);
  // The team a request's new team would start from, where its language has one.
  const besides = Object.fromEntries(
    (
      await Promise.all(
        requests.map(async (request) => {
          const first = request.branch === "add-team" ? (await teamsOf(request.lang as Lang))[0] : undefined;
          return first ? [[request.id, first.name] as const] : [];
        }),
      )
    ).flat(),
  );

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={allLangs()}
        global
        tab="teams"
        description="A team keeps its own takes, voices and settings in each language it voices, and the people who regenerate them. A language's teams are equal."
      />
      <Wide>
        <TeamRequests initial={requests} besides={besides} />
        <TeamsTable initial={teams} languages={languageOptions()} />
      </Wide>
    </main>
  );
}
