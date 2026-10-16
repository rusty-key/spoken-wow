import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Explorer } from "@/components/zones/Explorer";
import { isCorpusEmpty, zoneFacets } from "@/lib/zones/catalogue";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Places · Spoken" };

/**
 * The zone dropdown is derived from the catalogue, so computing it here and passing it
 * down beats a round trip that would buy nothing but an empty dropdown on first paint.
 *
 * RENDERED PER REQUEST, not at build. The catalogue is `lore_line`, which changes every
 * time somebody edits a line -- prerendering this would pin the dropdown to whatever the
 * corpus said when the image was built, and would need a database at build time to say
 * even that.
 */
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  let zones;
  try {
    zones = await zoneFacets(lang);
  } catch (error) {
    // Said on the page rather than thrown at it. Between a fresh deployment and its
    // cutover this section has no rows yet, and a stack trace is the wrong way to tell
    // somebody that the import has not been run.
    if (!isCorpusEmpty(error)) throw error;
    return (
      <main className="pt-6 pb-36">
        <Contained>
          <h1 className="text-xl font-semibold">Zone lore</h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm">
            The lore corpus has not been loaded into this database yet, so there is nothing to
            show. It is seeded from the committed Lua with{" "}
            <code className="text-foreground">make zones-lore-import</code>.
          </p>
        </Contained>
      </main>
    );
  }

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Zone lore</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          The prose the addon reads when you walk into a place, for every zone and subzone.
          Unlike quest dialogue, these words are written rather than extracted: scraped from
          warcraft.wiki.gg, sometimes rewritten, and correctable here.
        </p>
      </Contained>
      {/* Suspense is required: Explorer calls useSearchParams(). */}
      {/* Outside the column: the explorer places its own search (capped) and table (wide). */}
      <Suspense>
        <Explorer zones={zones} />
      </Suspense>
    </main>
  );
}
