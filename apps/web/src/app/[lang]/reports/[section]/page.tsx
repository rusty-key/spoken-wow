import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ReportTable from "@/components/ReportTable";
import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import { can } from "@/lib/permissions";
import { isCategory, type Category, type Status } from "@/lib/reports/reports";
import {
  isStatusView,
  matchesReportSearch,
  pageOf,
  PAGE_SIZE,
  SECTIONS,
  sectionOfReport,
  sortedGroups,
  STATUS_VIEWS,
  type Section,
  type StatusView,
} from "@/lib/reports/query";
import { listReports } from "@/lib/reports/store";
import { isSection } from "@/lib/contributions/query";
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
  if (!isSection(section)) notFound();
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /issues and /voices: a member has no business
  // learning the page exists, and these rows hold prose written by strangers. Per language:
  // whoever may fix a language's text triages what is reported about it.
  const viewer = await viewerOf(session);
  if (!session || !can(viewer, "edit", lang)) notFound();

  const { view: rawView, category: rawCategory, q: rawQ, dir: rawDir, page: rawPage } = await searchParams;
  const view: StatusView = isStatusView(rawView) ? rawView : "open";
  // Unknown reads as "all" rather than as a filter nothing matches, which would look like
  // an empty queue - the same bargain every explorer's filter parser makes.
  const category: Category | "all" = isCategory(rawCategory) ? rawCategory : "all";
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const dir = rawDir === "asc" ? "asc" : "desc";

  // Every report in the language, each status and section: both rows of tabs count what the
  // others leave, and a language's reports are few enough to read whole.
  const all = (await listReports("all", "all", category, null, lang)).filter((report) =>
    matchesReportSearch(report, q),
  );
  const inSection = all.filter((report) => sectionOfReport(report) === section);
  const sectionCounts = Object.fromEntries(SECTIONS.map((key) => [key, 0])) as Record<Section, number>;
  for (const report of all) {
    if (view === "all" || report.status === view) sectionCounts[sectionOfReport(report)]++;
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

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">Reports</h1>
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
          canRegenerate={can(viewer, "regenerate", lang)}
        />
      </Wide>
    </main>
  );
}
