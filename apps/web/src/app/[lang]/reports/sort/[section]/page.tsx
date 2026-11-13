import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import SortQueue from "@/components/reports/SortQueue";
import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { can, isAdmin } from "@/lib/permissions";
import { queuesOf } from "@/lib/reports/reports";
import { sortQueue } from "@/lib/reports/sort";
import { latestPackVersions } from "@/lib/releases/store";
import { listReports, skippedIds } from "@/lib/reports/store";
import { lineIdsOfAddress } from "@/lib/reports/target";
import { corpus, isCorpusEmpty } from "@/lib/quests/catalogue";
import type { ReportGroup } from "@/lib/reports/rows";
import { isSource } from "@/lib/sections";

export const metadata: Metadata = { title: "Sort reports · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string; section: string }> }) {
  const lang = await pageLang(params);
  const { section } = await params;
  if (!isSource(section)) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  const queues = queuesOf(viewer, lang);
  if (!session || !queues.length) notFound();

  const [reports, skipped, latestPacks] = await Promise.all([
    listReports("open", section, "all", null, lang, queues),
    skippedIds(session.user.id, lang),
    latestPackVersions(section),
  ]);
  const groups = section === "quests" ? await withAddressLines(sortQueue(reports, skipped), lang) : sortQueue(reports, skipped);
  const canRegenerate = can(viewer, "regenerate", lang);

  return (
    <SortQueue
      source={section}
      groups={groups}
      canRegenerate={canRegenerate}
      canEditText={can(viewer, section === "quests" ? "regenerate" : "text", lang)}
      canContribute={can(viewer, "text", lang)}
      showNpcPage={isAdmin(session.user.role)}
      latestPacks={latestPacks}
    />
  );
}

/**
 * A quests report filed without a line picked names an address several lines can answer to (a
 * quest given in two voices, every line of an NPC), or one the corpus had no line for until
 * later. Its card shows each line the address means now.
 */
async function withAddressLines(groups: ReportGroup[], lang: Lang): Promise<ReportGroup[]> {
  if (!groups.some((group) => !group.reports[0].lineId && group.reports[0].target)) return groups;
  const lines = await corpus(lang).catch((error) => {
    if (isCorpusEmpty(error)) return null;
    throw error;
  });
  if (!lines) return groups;
  return Promise.all(
    groups.map(async (group) => {
      const { lineId, target } = group.reports[0];
      return lineId || !target ? group : { ...group, lineIds: await lineIdsOfAddress(target, lines) };
    }),
  );
}
