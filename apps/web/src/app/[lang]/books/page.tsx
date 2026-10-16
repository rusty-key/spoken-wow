import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Explorer } from "@/components/books/Explorer";
import { bookFacets, isCorpusEmpty } from "@/lib/books/catalogue";
import { Contained } from "@/components/Width";

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

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  let books;
  try {
    books = await bookFacets(lang);
  } catch (error) {
    // Said on the page rather than thrown at it. On any database that has the migration and
    // no rows this is the normal state, and a stack trace is the wrong way to tell somebody
    // that the import has not been run.
    if (!isCorpusEmpty(error)) throw error;
    return (
      <main className="pt-6 pb-36">
        <Contained>
          <h1 className="text-xl font-semibold">Readables</h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm">
            The books corpus has not been loaded into this database yet, so there is nothing to
            show. It is extracted from the vmangos world database with{" "}
            <code className="text-foreground">make books-extract</code> and imported with{" "}
            <code className="text-foreground">make books-import</code>.
          </p>
        </Contained>
      </main>
    );
  }

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Readables</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          Every book, letter, note and plaque the game will show you, page by page. Like quest
          dialogue and unlike zone lore, these are Blizzard&rsquo;s words: extracted from the
          world database rather than written here, and corrected only where a narrator would
          stumble over them.
        </p>
      </Contained>
      {/* Suspense is required: Explorer calls useSearchParams(). */}
      {/* Outside the column: the explorer places its own search (capped) and table (wide). */}
      <Suspense>
        <Explorer books={books} />
      </Suspense>
    </main>
  );
}
