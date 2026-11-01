import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import Link from "@/components/LocaleLink";
import ReportTable from "@/components/ReportTable";
import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import { can, isAdmin } from "@/lib/permissions";
import { isCategory, queuesOf, queueView, type Category, type Status } from "@/lib/reports/reports";
import {
  isSection,
  isStatusView,
  matchesReportSearch,
  pageOf,
  PAGE_SIZE,
  SECTIONS,
  sortedGroups,
  STATUS_VIEWS,
  type Section,
  type StatusView,
} from "@/lib/reports/query";
import { npcDetails } from "@/lib/reports/npc";
import { listReports, queueHolders } from "@/lib/reports/store";
import { queryOf } from "@/lib/contributions/query";
import { localeHref } from "@/lib/lang";
import { Contained, Wide } from "@/components/Width";

export const metadata: Metadata = { title: "Reports · Spoken" };

// What strangers filed and what people did about it; nothing here can be cached between views.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; section: string }>;
  searchParams: Promise<{ view?: string; category?: string; q?: string; dir?: string; page?: string }>;
}) {
  const lang = await pageLang(params);
  const { section } = await params;
  // Gossip was a tab of its own; its reports are quests reports.
  if (section === "gossip") redirect(localeHref(lang, `/reports/quests?${queryOf(await searchParams)}`));
  if (!isSection(section)) notFound();
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /issues and /voices: a member has no business
  // learning the page exists, and these rows hold prose written by strangers. Per language and
  // per queue: whoever keeps a language's text or voices it triages what is reported to them.
  const viewer = await viewerOf(session);
  const queues = queuesOf(viewer, lang);
  if (!session || !queues.length) notFound();

  const { view: rawView, category: rawCategory, q: rawQ, dir: rawDir, page: rawPage } = await searchParams;
  const view: StatusView = isStatusView(rawView) ? rawView : "open";
  // Unknown reads as "all" rather than as a filter nothing matches, which would look like
  // an empty queue - the same bargain every explorer's filter parser makes.
  const category: Category | "all" = isCategory(rawCategory) ? rawCategory : "all";
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const dir = rawDir === "asc" ? "asc" : "desc";

  // Every report in the language, each status and section: both rows of tabs count what the
  // others leave, and a language's reports are few enough to read whole.
  const [reports, holders] = await Promise.all([
    listReports("all", "all", category, null, lang, queues),
    queueHolders(lang),
  ]);
  const all = reports.filter((report) => matchesReportSearch(report, q));
  const inSection = all.filter((report) => report.source === section);
  const sectionCounts = Object.fromEntries(SECTIONS.map((key) => [key, 0])) as Record<Section, number>;
  for (const report of all) {
    if (isSection(report.source) && (view === "all" || report.status === view)) sectionCounts[report.source]++;
  }
  const statusCounts = Object.fromEntries(STATUS_VIEWS.map((key) => [key, 0])) as Record<StatusView, number>;
  for (const report of inSection) {
    statusCounts[report.status as Status]++;
    statusCounts.all++;
  }

  const matching = inSection.filter((report) => view === "all" || report.status === view);
  const groups = sortedGroups(matching, dir);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const page = Math.min(pageOf(rawPage), pages);
  const shown = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // A report with no line is about its address; in quests that is most often a gossip NPC.
  const targets = shown.flatMap(({ reports: [first] }) => (!first.lineId && first.target ? [first.target] : []));
  const npcs = section === "quests" ? await npcDetails(targets, lang) : {};
  const { labelled, passTo } = queueView(queues, holders);

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">Reports</h1>
          <Link href="/reports/sort" className="text-sm underline-offset-2 hover:underline">
            Sort one at a time
          </Link>
        </div>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          What players filed from inside the game. A report is a claim, not a verdict: read it,
          listen to the line, and if it is right, queue the file for regeneration the usual way.
          Nothing here starts a job on its own.
        </p>
      </Contained>
      <Wide>
        <ReportTable
          groups={shown}
          total={matching.length}
          page={page}
          pages={pages}
          sectionCounts={sectionCounts}
          statusCounts={statusCounts}
          filters={{ section, view, category, q, dir }}
          npcs={npcs}
          canRegenerate={can(viewer, "regenerate", lang)}
          canContribute={can(viewer, "text", lang)}
          labelled={labelled}
          passTo={passTo}
          showNpcPage={isAdmin(session.user.role)}
        />
      </Wide>
    </main>
  );
}
