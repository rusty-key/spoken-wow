import "server-only";

import TeamPicker from "@/components/TeamPicker";
import { Contained } from "@/components/Width";
import type { Lang } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { currentChoice } from "@/lib/teams/acting-cookie";
import { teamsVoicing } from "@/lib/teams/viewing";

/**
 * On every page of a language, which team a site owner acts inside while the acting cookie
 * names one other than the main team, with the picker to change it. The cookie is read first:
 * without an entry for `lang`, as for everyone who is not a site owner, nothing else is read.
 */
export default async function ActingBanner({ lang }: { lang: Lang }) {
  const slug = (await currentChoice())[lang];
  if (!slug) return null;
  const teams = await teamsVoicing(lang);
  const team = teams.find((candidate) => candidate.slug === slug && !candidate.privileged);
  if (!team || !isAdmin((await currentSession())?.user.role)) return null;
  return (
    <div className="bg-muted/40 border-b">
      <Contained className="flex flex-wrap items-center gap-x-4 py-2 text-sm">
        <p className="font-medium">{`Working as ${team.name}`}</p>
        <TeamPicker
          teams={teams}
          viewed={{ team: team.id, slug: team.slug, name: team.name, own: true }}
          home={team.slug}
          className=""
        />
      </Contained>
    </div>
  );
}
