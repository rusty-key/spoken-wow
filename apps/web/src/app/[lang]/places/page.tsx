import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PlacesExplorer } from "@/components/places/PlacesExplorer";
import { isCorpusEmpty, zoneFacets } from "@/lib/places/catalogue";
import AudioPage, { AudioPageEmpty } from "@/components/catalogue/AudioPage";
import { viewKey } from "@/lib/teams/view";
import { teamView } from "@/lib/teams/viewing";

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

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
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
      <AudioPage lang={lang} section="places">
        <AudioPageEmpty>
            The lore corpus has not been loaded into this database yet, so there is nothing to
            show. It is seeded from the committed Lua with{" "}
            <code className="text-foreground">make places-lore-import</code>.
          </AudioPageEmpty>
      </AudioPage>
    );
  }

  // An unknown team slug falls back to the default team.
  const { team } = await searchParams;
  const view = await teamView(lang, typeof team === "string" ? team : null);

  return (
    <AudioPage lang={lang} section="places" team={typeof team === "string" ? team : undefined}>
      {/* Suspense is required: Explorer calls useSearchParams(). */}
      {/* Outside the column: the explorer places its own search (capped) and table (wide). */}
      <Suspense>
        <PlacesExplorer key={viewKey(view)} zones={zones} {...view} />
      </Suspense>
    </AudioPage>
  );
}
