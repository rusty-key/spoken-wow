import "server-only";

import { cache } from "react";

import TeamPicker from "@/components/TeamPicker";
import { Contained } from "@/components/Width";
import type { Lang } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { currentChoice } from "@/lib/teams/acting-cookie";
import { teamsVoicing, type TeamChoice } from "@/lib/teams/viewing";

export type Acting = { teams: TeamChoice[]; team: TeamChoice };

/**
 * The team a site owner acts inside in `lang` through the acting cookie, else null. The route
 * keeps an entry only where it changes who they act as, so an entry is what the banner shows.
 * The cookie is read first, since it costs no query: without an entry for `lang`, as for
 * everyone who is not a site owner, nothing else is read, and an English page still renders
 * with the database down.
 */
export const actingIn = cache(async (lang: Lang): Promise<Acting | null> => {
  const slug = (await currentChoice())[lang];
  if (!slug) return null;
  // Without the banner rather than without the page: a kept entry must not make an English page
  // depend on a database that is down.
  try {
    // Empty for a language with one team, from the memo alone.
    const teams = await teamsVoicing(lang);
    const team = teams.find((candidate) => candidate.slug === slug);
    if (!team || !isAdmin((await currentSession())?.user.role)) return null;
    return { teams, team };
  } catch {
    return null;
  }
});

/** On every page of the language, which team the site owner works as, with the picker to change it. */
export default function ActingBanner({ teams, team }: Acting) {
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
