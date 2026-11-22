import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ContributionsTabs from "@/components/ContributionsTabs";
import NameContributionTable from "@/components/NameContributionTable";
import BackstagePage from "@/components/backstage/BackstagePage";
import { Tabs } from "@/components/backstage/Tabs";
import { auth } from "@/lib/auth";
import { pendingCounts } from "@/lib/contributions/pending";
import { viewerOf } from "@/lib/grants/store";
import { BASE_LANG, isClientLang, localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { countObservedNames, isNameStatus, listObservedNames, type NameStatus } from "@/lib/names/observed";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Names · Contributions · Spoken" };

export const dynamic = "force-dynamic";

const STATUS_TABS: { value: NameStatus; label: string }[] = [
  { value: "new", label: "To review" },
  { value: "accepted", label: "Kept" },
  { value: "rejected", label: "Dropped" },
];

/** English has no page: its names are the corpus's. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  // 404, so a member does not learn the page exists: keeping a name writes the language's names.
  if (!session || !can(await viewerOf(session), "text", lang)) notFound();
  if (lang === BASE_LANG || !isClientLang(lang)) notFound();

  const { status: rawStatus } = await searchParams;
  const status: NameStatus = isNameStatus(rawStatus) ? rawStatus : "new";
  const [rows, waiting, pending] = await Promise.all([
    listObservedNames(lang, status),
    countObservedNames(lang),
    pendingCounts(lang),
  ]);

  return (
    <BackstagePage
      width="wide"
      title="Review"
      description="Names players' games show for an NPC, where the addon shows another. Keep the name their game shows, and the quest log and tracker show it after the next export."
    >
      <div className="mb-6">
        <ContributionsTabs lang={lang} section="names" pending={pending} names={waiting} />
      </div>
      <div className="mb-5">
        <Tabs
          label="Status"
          active={status}
          tabs={STATUS_TABS.map((tab) => ({
            value: tab.value,
            label: tab.label,
            href: localeHref(lang, `/contributions/names?status=${tab.value}`),
            count: tab.value === "new" ? waiting : undefined,
          }))}
        />
      </div>
      <NameContributionTable key={status} initial={rows} />
    </BackstagePage>
  );
}
