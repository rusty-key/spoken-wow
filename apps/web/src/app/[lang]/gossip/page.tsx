import type { Metadata } from "next";
import { Suspense } from "react";

import Explorer from "@/components/Explorer";
import { facets } from "@/lib/facets";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Gossip · Spoken" };

export default async function Page() {
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Gossip</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          Browse and play what NPCs say when you talk to them outside a quest, or search by NPC
          or what the line says. Read-only: nothing here writes to the corpus, the audio store,
          or your game install.
        </p>
      </Contained>
      {/* Outside the column: the explorer places its own search (capped) and table (wide). */}
      <Suspense>
        <Explorer facets={await facets()} kind="gossip" />
      </Suspense>
    </main>
  );
}
