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
import { hasBuiltinPlayerWords, playerWordsOf } from "@/lib/player-words";

export const metadata: Metadata = { title: "Player words · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  // 404, not a redirect: only a text maintainer may learn of it, and only where the words are not code.
  if (!session || !can(await viewerOf(session), "text", lang) || hasBuiltinPlayerWords(lang)) notFound();

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Player words</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          The game writes $N, $C and $R where it says the player&apos;s name, class and race. A recording is one
          file for everybody, so in {langName(lang)} it says these words there instead. Every team of the language
          voices them. Without them, a line holding one of those tokens cannot be generated.
        </p>
        <PlayerWordsEditor lang={lang} initial={playerWordsOf(lang)} />
      </Contained>
    </main>
  );
}
