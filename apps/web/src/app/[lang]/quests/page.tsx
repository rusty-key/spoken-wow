import type { Metadata } from "next";
import { Suspense } from "react";

import Explorer from "@/components/Explorer";
import { facets } from "@/lib/facets";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Quests · Spoken" };

export default async function Page() {
  // Read here rather than fetched: the filter options are derived from a corpus that is
  // committed and does not change while the server runs, so a round trip for them would buy
  // nothing but an empty dropdown on first paint.
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Quest dialogue</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          Browse and play every quest voiceline, and what NPCs say after a quest, or search by
          NPC, quest, or what the line says. Read-only: nothing here writes to the corpus, the
          audio store, or your game install.
        </p>
      </Contained>
      {/* Outside the column: the explorer places its own search (capped) and table (wide). */}
      <Suspense>
        <Explorer facets={await facets()} kind="quests" />
      </Suspense>
    </main>
  );
}
