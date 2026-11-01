import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LocaleLink from "@/components/LocaleLink";
import ReleasePanel from "@/components/ReleasePanel";
import { Contained } from "@/components/Width";
import { viewerOf } from "@/lib/grants/store";
import { langName } from "@/lib/lang";
import { langsWhere } from "@/lib/permissions";
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
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Release</h1>
        <LocaleLink href="/admin" className="text-muted-foreground text-sm hover:underline">
          Users
        </LocaleLink>
        {administered.length > 1 && (
          <nav className="mt-3 flex flex-wrap gap-3 text-sm">
            {administered.map((code) => (
              <LocaleLink
                key={code}
                href={`/admin/release?lang=${code}`}
                className={code === lang ? "font-semibold" : "text-muted-foreground hover:underline"}
              >
                {langName(code)}
              </LocaleLink>
            ))}
          </nav>
        )}
        <p className="text-muted-foreground mt-3 mb-5 text-sm">
          Publish a section&apos;s sound pack for {langName(lang)} to the Manager. A release takes
          a while: it reads production and builds the pack first.
        </p>
        <ReleasePanel key={lang} lang={lang} initial={await releaseView(lang)} />
      </Contained>
    </main>
  );
}
