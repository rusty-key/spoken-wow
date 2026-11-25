import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import ReleasePanel from "@/components/ReleasePanel";
import { Contained } from "@/components/Width";
import { viewerOf } from "@/lib/grants/store";
import { langName } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { uiText } from "@/lib/ui-text";
import { fill } from "@/lib/site-text/format";
import { isAdmin, langsWhere } from "@/lib/permissions";
import { releasesClosedFor } from "@/lib/releases/droplet";
import { releaseView } from "@/lib/releases/view";
import { currentSession } from "@/lib/session";
import { actingTeamRow } from "@/lib/teams/store";

export const metadata: Metadata = { title: "Release · Spoken" };

export const dynamic = "force-dynamic";

/**
 * The `[lang]` segment is the site's language, so the language released comes from `?lang=`, the
 * first one administered when absent.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const session = await currentSession();
  const viewer = await viewerOf(session);
  const administered = langsWhere(viewer, "admin");
  if (!session || !viewer || administered.length === 0) notFound();

  const t = (await uiText(await readingLang((await params).lang))).admin;
  const { lang: asked } = await searchParams;
  const lang = administered.find((code) => code === asked) ?? administered[0];
  const closed = releasesClosedFor(await actingTeamRow(lang));

  return (
    <main className="pb-36">
      <AdminHeader
        lang={lang}
        administered={administered}
        global={isAdmin(viewer.role)}
        tab="release"
        description={fill(t.releaseLede, { lang: langName(lang) })}
      />
      <Contained className="pt-6">
        {closed ? (
          <p className="text-muted-foreground text-sm">{t.releasesClosed}</p>
        ) : (
          <ReleasePanel key={lang} lang={lang} initial={await releaseView(lang)} />
        )}
      </Contained>
    </main>
  );
}
