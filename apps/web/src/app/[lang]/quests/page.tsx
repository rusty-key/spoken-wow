import type { Metadata } from "next";
import { Suspense } from "react";

import Explorer from "@/components/Explorer";
import { facets } from "@/lib/facets";
import { pageLang } from "@/lib/lang-server";
import { Contained } from "@/components/Width";
import { teamView } from "@/lib/teams/viewing";

export const metadata: Metadata = { title: "Quests · Spoken" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const lang = await pageLang(params);
  // Whose takes the explorer plays, picked by `?team=`; a slug naming no team of the
  // language plays the default's.
  const { team } = await searchParams;
  const view = await teamView(lang, typeof team === "string" ? team : null);
  // Read here rather than fetched: the filter options are derived from a corpus that is
  // committed and does not change while the server runs, so a round trip for them would buy
  // nothing but an empty dropdown on first paint. The acting team's roster, in another team's
  // view too: the search route checks the voice filter against that one.
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
        <Explorer facets={await facets(lang)} {...view} />
      </Suspense>
    </main>
  );
}
