import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import SortQueue from "@/components/reports/SortQueue";
import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import { BASE_LANG } from "@/lib/lang";
import { can, isAdmin } from "@/lib/permissions";
import { sortQueue } from "@/lib/reports/sort";
import { listReports, skippedIds } from "@/lib/reports/store";
import { isSource } from "@/lib/sections";

export const metadata: Metadata = { title: "Sort reports · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string; section: string }> }) {
  const lang = await pageLang(params);
  const { section } = await params;
  if (!isSource(section)) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  if (!session || !(can(viewer, "text", lang) || can(viewer, "edit", lang))) notFound();

  const [reports, skipped] = await Promise.all([
    listReports("open", section, "all", null, lang),
    skippedIds(session.user.id, lang),
  ]);
  const groups = sortQueue(reports, skipped);
  const canRegenerate = can(viewer, "regenerate", lang);

  return (
    <SortQueue
      source={section}
      groups={groups}
      canRegenerate={canRegenerate}
      // English quest text is rewritten through an override, which spends nothing itself but
      // is guarded as regeneration is (OverrideDialog); every other text is an edit.
      canEditText={section === "quests" && lang === BASE_LANG ? canRegenerate : can(viewer, "text", lang)}
      showNpcPage={isAdmin(session.user.role)}
    />
  );
}
