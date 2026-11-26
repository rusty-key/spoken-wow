import type { Metadata } from "next";

import BackstagePage from "@/components/backstage/BackstagePage";
import Listen from "@/components/listen/Listen";
import { langName } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { currentSession } from "@/lib/session";
import { fill } from "@/lib/site-text/format";
import { uiText } from "@/lib/ui-text";
import { publicVoices, votesOf } from "@/lib/voice-feedback/public";
import { currentVoter } from "@/lib/voice-feedback/voter";

/**
 * Players' say on the voices designed for a language: open to everyone, signed in or not. The
 * session and the voter cookie decide which votes are this visitor's own.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const lang = await pageLang(params);
  const t = (await uiText(await readingLang(lang))).listen;
  return { title: `${fill(t.title, { lang: langName(lang) })} · Spoken`, description: t.lede };
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const t = (await uiText(await readingLang(lang))).listen;
  const session = await currentSession();
  const voter = await currentVoter(session?.user.id ?? null);
  const [voices, votes] = await Promise.all([publicVoices(lang), voter ? votesOf(lang, voter) : {}]);
  return (
    <BackstagePage title={fill(t.title, { lang: langName(lang) })} description={t.lede} width="wide">
      <Listen lang={lang} voices={voices} votes={votes} />
    </BackstagePage>
  );
}
