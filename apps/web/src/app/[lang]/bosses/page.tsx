import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BossesExplorer } from "@/components/bosses/BossesExplorer";
import { instanceFacets } from "@/lib/bosses/catalogue";
import { Contained } from "@/components/Width";
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
  const instances = await instanceFacets(lang);

  // Every live boss is listed in every language, so no instances means no boss rows at all:
  // the intake has not been run against this database.
  if (instances.length === 0) {
    return (
      <main className="pt-6 pb-36">
        <Contained>
          <h1 className="text-xl font-semibold">Bosses</h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm">
            The boss tables have not been loaded into this database yet, so there is nothing to
            show. They are seeded from the committed Lua by the one-off intake,{" "}
            <code className="text-foreground">import-boss-lore.mts</code>, and{" "}
            <code className="text-foreground">make bosses-check</code> passes once it has run.
          </p>
        </Contained>
      </main>
    );
  }

  // An unknown team slug falls back to the default team.
  const { team } = await searchParams;
  const view = await teamView(lang, typeof team === "string" ? team : null);

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Bosses</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          The story Spoken tells when a boss falls, for every dungeon and raid boss. Written from
          the Adventure Guide and warcraft.wiki.gg, rewritten in one voice, and correctable here.
        </p>
      </Contained>
      {/* Suspense is required: Explorer calls useSearchParams(). */}
      <Suspense>
        <BossesExplorer key={viewKey(view)} instances={instances} {...view} />
      </Suspense>
    </main>
  );
}
