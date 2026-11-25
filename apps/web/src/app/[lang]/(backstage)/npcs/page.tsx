import type { Metadata } from "next";
import { notFound } from "next/navigation";

import NpcEditor from "@/components/NpcEditor";
import { LinkTabs } from "@/components/StatusTabs";
import TypesEditor from "@/components/TypesEditor";
import { Contained, Wide } from "@/components/Width";
import { clientOf } from "@/lib/contributions/client";
import { summaryFromResolution } from "@/lib/contributions/speaker";
import { BASE_LANG, localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { viewerOf } from "@/lib/grants/store";
import { listBodies, listLanguageDirections, listResolutions, resolutionKey, type NpcBodyAnswer } from "@/lib/npc/store";
import { can, isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { loadRoster } from "@/lib/voices/roster-store";

export const metadata: Metadata = { title: "NPCs · Spoken" };

// Other admins answer these too, from here and from the triage queue.
export const dynamic = "force-dynamic";

/**
 * Every NPC and who it is, and the types an NPC can be with the voice each is read by. An answer
 * here holds in every language, so it is the global admin's alone. Whoever configures the page's
 * language reads the NPCs and sets their directions in that language.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const lang = await pageLang(params);
  const session = await currentSession();
  if (!session) notFound();
  const admin = isAdmin(session.user.role);
  // English's own direction is the global one, which only the admin sets.
  const ownDirections = lang !== BASE_LANG && can(await viewerOf(session), "configure", lang);
  if (!admin && !ownDirections) notFound();

  const tab = admin && (await searchParams).tab === "types" ? "types" : "npcs";
  const npcs = tab === "npcs";
  const [roster, resolutions, bodies, languageDirections] = await Promise.all([
    loadRoster(lang),
    npcs ? listResolutions() : [],
    npcs ? listBodies() : new Map<string, NpcBodyAnswer[]>(),
    npcs && ownDirections ? listLanguageDirections(lang) : new Map<string, string>(),
  ]);

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">NPCs</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          {admin
            ? "Who every NPC is, and which voice reads each type. An answer here voices every line that NPC speaks, in every language; an NPC whose type no voice reads has none until it gets one."
            : "Who every NPC is, and the direction its lines are performed with."}
          {ownDirections ? " A direction of this language's own replaces the global one in this language only." : null}
        </p>
      </Contained>
      <Wide>
        {admin ? (
          <LinkTabs
            label="NPCs"
            active={tab}
            tabs={[
              { value: "npcs", label: "NPCs", href: localeHref(lang, "/npcs") },
              { value: "types", label: "Types", href: localeHref(lang, "/npcs?tab=types") },
            ]}
          />
        ) : null}
        {tab === "types" ? (
          <TypesEditor initial={roster.data} />
        ) : (
          <NpcEditor
            initial={resolutions.map((row) => ({
              ...summaryFromResolution(row, roster),
              // The client whose guess filed the NPC; none for one only the extract names.
              client: row.build ? clientOf(row.build).family : null,
              bodies: bodies.get(resolutionKey(row.npcKind, row.npcId)) ?? [],
              direction: row.direction ?? null,
              languageDirection: languageDirections.get(resolutionKey(row.npcKind, row.npcId)) ?? null,
            }))}
            roster={roster.data}
            readOnly={!admin}
            ownDirections={ownDirections}
          />
        )}
      </Wide>
    </main>
  );
}
