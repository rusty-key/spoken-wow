import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BossesExplorer } from "@/components/bosses/BossesExplorer";
import { instanceFacets } from "@/lib/bosses/catalogue";
import AudioPage, { AudioPageEmpty } from "@/components/catalogue/AudioPage";
import { viewKey } from "@/lib/teams/view";
import { teamView } from "@/lib/teams/viewing";

export const metadata: Metadata = { title: "Bosses · Spoken" };

/**
 * RENDERED PER REQUEST, not at build: the instance dropdown counts the stories written in the
 * page's language, which change with every edit, and a build has no database to read them from.
 */
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const lang = await pageLang(params);
  // Read before the empty-state return too, so its section tabs keep the team being viewed.
  const { team } = await searchParams;
  const viewedTeam = typeof team === "string" ? team : undefined;
  const instances = await instanceFacets(lang);

  // Every live boss is listed in every language, so no instances means no boss rows at all:
  // the intake has not been run against this database.
  if (instances.length === 0) {
    return (
      <AudioPage lang={lang} section="bosses" team={viewedTeam}>
        <AudioPageEmpty>
            The boss tables have not been loaded into this database yet, so there is nothing to
            show. They are seeded from the committed Lua by the one-off intake,{" "}
            <code className="text-foreground">import-boss-lore.mts</code>, and{" "}
            <code className="text-foreground">make bosses-check</code> passes once it has run.
          </AudioPageEmpty>
      </AudioPage>
    );
  }

  // An unknown team slug falls back to the default team.
  const view = await teamView(lang, viewedTeam ?? null);

  return (
    <AudioPage lang={lang} section="bosses" team={viewedTeam}>
      {/* Suspense is required: Explorer calls useSearchParams(). */}
      <Suspense>
        <BossesExplorer key={viewKey(view)} instances={instances} {...view} />
      </Suspense>
    </AudioPage>
  );
}
