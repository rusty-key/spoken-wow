import type { Metadata } from "next";
import { notFound } from "next/navigation";

import GameData from "@/components/GameData";
import { gameScript } from "@/lib/npc/game-script";
import { listUnconfirmed } from "@/lib/npc/store";
import { viewerOf } from "@/lib/grants/store";
import { BASE_LANG } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { can } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { uiText } from "@/lib/ui-text";
import { Contained, Wide } from "@/components/Width";

export const metadata: Metadata = { title: "Game data · Spoken" };

export const dynamic = "force-dynamic";

/**
 * Resolving NPCs from a game client's own data.
 *
 * Not linked from anywhere: a tool for whoever has a client to hand, alongside /contributions.
 * The client asks its server about each unresolved NPC, writes the answers to its creature
 * cache, and the cache comes back here to be turned into voices. See lib/npc/game-script.ts,
 * creature-cache.ts and display-voices.ts for the three steps.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  // 404, and gated as api/contributions/npc is (requireRegenerate), which this writes through.
  if (!can(await viewerOf(await currentSession()), "regenerate", BASE_LANG)) notFound();

  const t = (await uiText(await readingLang(lang))).contributions;

  const pending = await listUnconfirmed("creature");

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">{t.gameData}</h1>
        <p className="text-muted-foreground mt-1 mb-6 text-sm">{t.gameDataLede}</p>
      </Contained>
      <Wide>
        <GameData
          pending={pending.map((row) => ({ npcId: row.npcId, npcName: row.npcName, provenance: row.provenance }))}
          script={gameScript(pending.map((row) => row.npcId))}
        />
      </Wide>
    </main>
  );
}
