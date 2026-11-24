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
import { isStatus, type ContributionStatus } from "@/lib/contributions/contributions";
import { localeHref } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { countObservedNames, hasObservedNames, listObservedNames } from "@/lib/names/observed";
import { can } from "@/lib/permissions";
import { uiText } from "@/lib/ui-text";

export const metadata: Metadata = { title: "Names · Contributions · Spoken" };

export const dynamic = "force-dynamic";

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
  if (!hasObservedNames(lang)) notFound();

  const t = (await uiText(await readingLang(lang))).contributions.names;
  const statusTabs: { value: ContributionStatus; label: string }[] = [
    { value: "new", label: t.toReview },
    { value: "accepted", label: t.kept },
    { value: "rejected", label: t.dropped },
  ];

  const { status: rawStatus } = await searchParams;
  const status: ContributionStatus = isStatus(rawStatus) ? rawStatus : "new";
  const [rows, others, pending] = await Promise.all([
    listObservedNames(lang, status),
    status === "new" ? undefined : countObservedNames(lang),
    pendingCounts(lang),
  ]);
  const waiting = others ?? rows.length;

  return (
    <BackstagePage
      width="wide"
      title={t.title}
      description={t.lede}
    >
      <div className="mb-6">
        <ContributionsTabs lang={lang} section="names" pending={pending} names={waiting} showNames />
      </div>
      <div className="mb-5">
        <Tabs
          label={t.status}
          active={status}
          tabs={statusTabs.map((tab) => ({
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
