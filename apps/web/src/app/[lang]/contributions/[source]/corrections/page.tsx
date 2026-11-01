import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ContributionsTabs from "@/components/ContributionsTabs";
import CorrectionTable, { type CorrectionRow, type CorrectionSource } from "@/components/CorrectionTable";
import { auth } from "@/lib/auth";
import { clientFilterOf, clientOf, matchesClient } from "@/lib/contributions/client";
import { readable } from "@/lib/contributions/compare";
import { isStatus, type ContributionStatus } from "@/lib/contributions/contributions";
import { lineStates, tabOf } from "@/lib/contributions/known";
import {
  isQuestStage,
  isSearchIn,
  matchesSearch,
  matchesStage,
  stagesOf,
  type ClientFilter,
  type StageFilter,
} from "@/lib/contributions/query";
import { pendingCounts } from "@/lib/contributions/pending";
import { listContributions, observationMeta } from "@/lib/contributions/store";
import { explorerHref } from "@/lib/links";
import { observedFrom } from "@/lib/npc/resolve";
import { questFor } from "@/lib/contributions/triage";
import { viewerOf } from "@/lib/grants/store";
import { pageLang } from "@/lib/lang-server";
import { can } from "@/lib/permissions";
import { Contained, Wide } from "@/components/Width";

export const metadata: Metadata = { title: "Corrections · Spoken" };

// Read against a queue other people are resolving rows in, as the triage page is.
export const dynamic = "force-dynamic";

/**
 * Contributions for a quest moment or book page the corpus already has, whose text says
 * something else: the text as the corpus has it and as the player's client showed it, side by side.
 *
 * Gated as the triage page is -- the rows are the same table's. Accepting one writes the
 * player's text as what the line speaks (correction.ts), the explorer's text edit in one click;
 * the line is still linked for an edit of its own. Rejecting one is the same reject the triage
 * page sends.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; source: string }>;
  searchParams: Promise<{ status?: string; client?: string; stage?: string; q?: string; filter?: string }>;
}) {
  const lang = await pageLang(params);
  // Only quests and readables have text a contribution can disagree with word for word.
  const source = (await params).source;
  if (source !== "quests" && source !== "readables") notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  if (!session || !can(viewer, "text", lang)) notFound();

  const { status: rawStatus, client: rawClient, stage: rawStage, q: rawQ, filter: rawFilter } = await searchParams;
  const status: ContributionStatus = isStatus(rawStatus) ? rawStatus : "new";
  // Era and Forever by default: every other client is the low-effort bin, shown only on request.
  const client: ClientFilter = clientFilterOf(rawClient);
  // Gossip has no quest moment to correct, so only the three panels are offered.
  const stage: StageFilter = stagesOf(rawStage).filter(isQuestStage);
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const searchIn = isSearchIn(rawFilter) ? rawFilter : "any";

  const [all, pending] = await Promise.all([
    listContributions(status, lang, undefined, source),
    pendingCounts(lang),
  ]);
  const listed = all.filter((row) => matchesClient(clientOf(row.build).family, client));
  const states = await lineStates(listed);

  // Only what crosses into the client component, as page.tsx's ContributionRow projection says.
  const rows: CorrectionRow[] = listed.flatMap((row, index) => {
    const state = states[index];
    if (state.kind !== "changed" || tabOf(row.status, state) !== "corrections") return [];
    const quest = source === "quests" ? questFor(row) : null;
    if (source === "quests" && !matchesStage(quest, stage)) return [];
    const observed = observedFrom(observationMeta(row));
    const npc = observed.npcId === null ? null : { npcId: observed.npcId, npcName: observed.npcName };
    const wordings = state.wordings.map(
      (line) => ({ lineId: line.lineId, variant: line.variant, editHref: explorerHref(source, line.lineId), before: readable(line.text) }),
    );
    // Either side can hold the words somebody remembers: the corpus's or the player's.
    const corpusText = wordings.map((line) => line.before).join("\n");
    if (!matchesSearch({ text: `${row.text ?? ""}\n${corpusText}`, npc: npc ?? undefined, quest }, q, searchIn)) return [];
    return [
      {
        id: row.id,
        wordings,
        closest: state.closest,
        quest: quest === "gossip" ? null : quest,
        title: source === "readables" ? bookTitleOf(row.meta) : null,
        client: clientOf(row.build),
        locale: row.locale,
        count: row.count,
        createdAt: row.createdAt,
        status: row.status,
        npc,
        after: row.text ?? "",
        body: row.body,
      },
    ];
  });

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">Contributions</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          {source === "readables"
            ? "Pages the corpus already has in this language, sent back with different words -- usually the game showing a page differently from the extract. Accept a correction to save the player's words as the page's new version; reject one that is wrong."
            : "Lines the corpus already has, sent back with different text -- usually the game rewording a quest since the corpus was extracted. Accept a correction to make the player's text what the line speaks; reject one that is wrong."}
        </p>
      </Contained>
      <Wide>
        <ContributionsTabs lang={lang} section={source} view="corrections" pending={pending} />
        <CorrectionTable source={source as CorrectionSource} initial={rows} status={status} client={client} stage={stage} q={q} searchIn={searchIn} />
      </Wide>
    </main>
  );
}

/** The title and page number a client showed a book page under, as the table's first column. */
function bookTitleOf(meta: Record<string, string>): string | null {
  const title = meta.book?.trim();
  if (!title) return null;
  return meta.number ? `${title} p.${meta.number}` : title;
}
