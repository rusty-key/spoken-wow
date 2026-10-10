import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import NpcEditor from "@/components/NpcEditor";
import { LinkTabs } from "@/components/StatusTabs";
import TypesEditor from "@/components/TypesEditor";
import { Contained, Wide } from "@/components/Width";
import { auth } from "@/lib/auth";
import { summaryFromResolution } from "@/lib/contributions/speaker";
import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { listResolutions } from "@/lib/npc/store";
import { isAdmin } from "@/lib/permissions";
import { Roster } from "@/lib/voices/roster";
import { rosterData } from "@/lib/voices/roster-store";

export const metadata: Metadata = { title: "NPCs · Spoken" };

// Other admins answer these too, from here and from the triage queue.
export const dynamic = "force-dynamic";

/**
 * Every NPC and who it is, and the types an NPC can be with the voice each is read by. An answer
 * here holds in every language, so it is the global admin's alone.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdmin(session.user.role)) notFound();

  const tab = (await searchParams).tab === "types" ? "types" : "npcs";
  const data = await rosterData();

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">NPCs</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          Who every NPC is, and which voice reads each type. An answer here voices every line that NPC
          speaks, in every language; an NPC whose type no voice reads has none until it gets one.
        </p>
      </Contained>
      <Wide>
        <LinkTabs
          label="NPCs"
          active={tab}
          tabs={[
            { value: "npcs", label: "NPCs", href: localeHref(lang, "/npcs") },
            { value: "types", label: "Types", href: localeHref(lang, "/npcs?tab=types") },
          ]}
        />
        {tab === "types" ? (
          <TypesEditor initial={data} />
        ) : (
          <NpcEditor
            initial={(await listResolutions()).map((row) => summaryFromResolution(row, new Roster(data)))}
            roster={data}
          />
        )}
      </Wide>
    </main>
  );
}
