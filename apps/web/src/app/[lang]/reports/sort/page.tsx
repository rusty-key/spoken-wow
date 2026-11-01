import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import SortPicker from "@/components/reports/SortPicker";
import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import { can } from "@/lib/permissions";
import { queueCounts } from "@/lib/reports/sort";
import { listReports, skippedIds } from "@/lib/reports/store";
import { SOURCES, type Source } from "@/lib/sections";

export const metadata: Metadata = { title: "Sort reports · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  // The same gate as /reports: these are the same reports, a card at a time.
  const viewer = await viewerOf(session);
  if (!session || !(can(viewer, "text", lang) || can(viewer, "edit", lang))) notFound();

  const [open, skipped] = await Promise.all([
    listReports("open", "all", "all", null, lang),
    skippedIds(session.user.id, lang),
  ]);
  const counts = Object.fromEntries(
    SOURCES.map((source) => [source, queueCounts(open.filter((report) => report.source === source), skipped)]),
  ) as Record<Source, { left: number; skipped: number }>;

  return (
    <main className="mx-auto max-w-xl px-4 pt-6 pb-24">
      <h1 className="text-xl font-semibold">Sort reports</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        One line at a time: listen, fix or dismiss, next.
      </p>
      <SortPicker counts={counts} />
    </main>
  );
}
