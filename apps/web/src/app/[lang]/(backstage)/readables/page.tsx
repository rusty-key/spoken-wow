import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Explorer } from "@/components/readables/Explorer";
import { bookFacets, isCorpusEmpty } from "@/lib/readables/catalogue";
import AudioPage, { AudioPageEmpty } from "@/components/catalogue/AudioPage";
import { viewKey } from "@/lib/teams/view";
import { teamView } from "@/lib/teams/viewing";

export const metadata: Metadata = { title: "Readables · Spoken" };

/**
 * The book dropdown is derived from the corpus, so computing it here and passing it down
 * beats a round trip that would buy nothing but an empty dropdown on first paint.
 *
 * RENDERED PER REQUEST, not at build. The corpus is `book_line`, which changes whenever the
 * extract is re-run -- prerendering this would pin the dropdown to whatever the table said
 * when the image was built, and would need a database at build time to say even that.
 */
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const lang = await pageLang(params);
  // Read before the empty-state return too, so its section tabs keep the team being viewed.
  const { team } = await searchParams;
  const viewedTeam = typeof team === "string" ? team : undefined;
  let books;
  try {
    books = await bookFacets(lang);
  } catch (error) {
    // Said on the page rather than thrown at it. On any database that has the migration and
    // no rows this is the normal state, and a stack trace is the wrong way to tell somebody
    // that the import has not been run.
    if (!isCorpusEmpty(error)) throw error;
    return (
      <AudioPage lang={lang} section="readables" team={viewedTeam}>
        <AudioPageEmpty>
            The readables corpus has not been loaded into this database yet, so there is nothing to
            show. It is extracted from the vmangos world database with{" "}
            <code className="text-foreground">make readables-extract</code> and imported with{" "}
            <code className="text-foreground">make readables-import</code>.
          </AudioPageEmpty>
      </AudioPage>
    );
  }

  // An unknown team slug falls back to the default team.
  const view = await teamView(lang, viewedTeam ?? null);

  return (
    <AudioPage lang={lang} section="readables" team={viewedTeam}>
      {/* Suspense is required: Explorer calls useSearchParams(). */}
      {/* Outside the column: the explorer places its own search (capped) and table (wide). */}
      <Suspense>
        <Explorer key={viewKey(view)} books={books} {...view} />
      </Suspense>
    </AudioPage>
  );
}
