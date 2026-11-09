import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import ReleasePanel from "@/components/ReleasePanel";
import { Contained } from "@/components/Width";
import { viewerOf } from "@/lib/grants/store";
import { langName } from "@/lib/lang";
import { isAdmin, langsWhere } from "@/lib/permissions";
import { releaseView } from "@/lib/releases/view";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Release · Spoken" };

export const dynamic = "force-dynamic";

/**
 * The `[lang]` segment is the site's language, so the language released comes from `?lang=`, the
 * first one administered when absent.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const session = await currentSession();
  const viewer = await viewerOf(session);
  const administered = langsWhere(viewer, "admin");
  if (!session || !viewer || administered.length === 0) notFound();

  const { lang: asked } = await searchParams;
  const lang = administered.find((code) => code === asked) ?? administered[0];

  return (
    <main className="pb-36">
      <AdminHeader
        lang={lang}
        administered={administered}
        global={isAdmin(viewer.role)}
        tab="release"
        description={`Publish ${langName(lang)}'s sound packs to the Manager. A release marks the latest takes and rebuilds the addon files; it takes a while, since it reads production and builds the pack first.`}
      />
      <Contained className="pt-6">
        <ReleasePanel key={lang} lang={lang} initial={await releaseView(lang)} />
      </Contained>
    </main>
  );
}
