import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import PlayerWordsEditor from "@/components/PlayerWordsEditor";
import { Contained } from "@/components/Width";
import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import { langName } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { can } from "@/lib/permissions";
import { builtinPlayerWordsOf, hasRegisteredPlayerWords, playerWordsOf } from "@/lib/player-words";

export const metadata: Metadata = { title: "Player words · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  // 404, not a redirect: only a text maintainer may learn of it.
  if (!session || !can(await viewerOf(session), "text", lang)) notFound();
  const defaults = builtinPlayerWordsOf(lang);

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Player words</h1>
        <p className="text-muted-foreground mt-1 mb-3 text-sm">
          The game writes $N, $C and $R where it says the player&apos;s name, class and race. A recording is one
          file for everybody, so in {langName(lang)} it says these words there instead. Every team of the language
          voices them. Without them, a line holding one of those tokens cannot be generated.
        </p>
        <p className="text-muted-foreground mb-5 text-sm">
          A Craftsman&apos;s Writ asks for $2oa of an item, a count the game fills in. The writ&apos;s count words
          stand in for it, before the item&apos;s name, so they must read with any item: English says &quot;an order
          of&quot;. Without them, a line holding $2oa cannot be generated.
        </p>
        <p className="text-muted-foreground mb-5 text-sm">
          Russian text wraps a token in a declension, |3-6($c): the game prints the class in case 6. Declined forms
          give the word for each case number, such as путника for case 1 (genitive). A line holding a case with no
          word cannot be generated.
        </p>
        {defaults && (
          <p className="text-muted-foreground mb-5 text-sm">
            Spoken has its own words for {langName(lang)}. Words saved here replace them; Reset returns to them.
          </p>
        )}
        <PlayerWordsEditor
          lang={lang}
          initial={playerWordsOf(lang)}
          defaults={defaults}
          saved={hasRegisteredPlayerWords(lang)}
        />
      </Contained>
    </main>
  );
}
