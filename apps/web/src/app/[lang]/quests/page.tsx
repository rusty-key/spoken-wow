import type { Metadata } from "next";
import { Suspense } from "react";

import Explorer from "@/components/Explorer";
import { facets } from "@/lib/facets";
import { pageLang } from "@/lib/lang-server";
import AudioPage from "@/components/catalogue/AudioPage";
import { viewKey } from "@/lib/teams/view";
import { asViewed, teamView } from "@/lib/teams/viewing";

export const metadata: Metadata = { title: "Quests · Spoken" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const lang = await pageLang(params);
  // An unknown team slug falls back to the default team.
  const { team } = await searchParams;
  const view = await teamView(lang, typeof team === "string" ? team : null);
  // Read here rather than fetched, so the filters are there on first paint; as the viewed team,
  // since its roster names the voices that can match.
  return (
    <AudioPage lang={lang} section="quests" team={typeof team === "string" ? team : undefined}>
      {/* The explorer places its own search (in the column) and table (full width). */}
      <Suspense>
        <Explorer key={viewKey(view)} facets={await asViewed(lang, view.viewed, () => facets(lang))} {...view} />
      </Suspense>
    </AudioPage>
  );
}
