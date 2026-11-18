import type { Metadata } from "next";
import { Suspense } from "react";

import Explorer from "@/components/Explorer";
import { facets } from "@/lib/facets";
import { pageLang } from "@/lib/lang-server";
import { Contained } from "@/components/Width";
import { viewKey } from "@/lib/teams/view";
import { asViewed, teamView } from "@/lib/teams/viewing";

export const metadata: Metadata = { title: "Quests · Spoken" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const lang = await pageLang(params);
  // An unknown team slug falls back to the default team.
  const { team } = await searchParams;
  const view = await teamView(lang, typeof team === "string" ? team : null);
  // Read here rather than fetched, so the filters are there on first paint; as the viewed team,
  // since its roster names the voices that can match.
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Quest dialogue</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          Browse and play every quest and gossip voiceline, and what NPCs say after a quest, or
          search by NPC, quest, or what the line says. Read-only: nothing here writes to the
          corpus, the audio store, or your game install.
        </p>
      </Contained>
      {/* Outside the column: the explorer places its own search (capped) and table (wide). */}
      <Suspense>
        <Explorer key={viewKey(view)} facets={await asViewed(lang, view.viewed, () => facets(lang))} {...view} />
      </Suspense>
    </main>
  );
}
