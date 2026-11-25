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
import { readingLang } from "@/lib/lang-server";
import { uiText } from "@/lib/ui-text";
import { fill } from "@/lib/site-text/format";

export const metadata: Metadata = { title: "Player words · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  // 404, not a redirect: only a text maintainer may learn of it.
  if (!session || !can(await viewerOf(session), "text", lang)) notFound();
  const defaults = builtinPlayerWordsOf(lang);
  const t = (await uiText(await readingLang(lang))).playerWords;

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground mt-1 mb-3 text-sm">{fill(t.lede, { lang: langName(lang) })}</p>
        <p className="text-muted-foreground mb-5 text-sm">{t.quantityLede}</p>
        <p className="text-muted-foreground mb-5 text-sm">{t.declinedLede}</p>
        {defaults && (
          <p className="text-muted-foreground mb-5 text-sm">
            {fill(t.builtinLede, { lang: langName(lang) })}
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
