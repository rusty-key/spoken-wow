import type { Metadata } from "next";

import BackstagePage from "@/components/backstage/BackstagePage";
import { body, display } from "@/components/landing/fonts";
import LandingHeader from "@/components/landing/LandingHeader";
import { SiteTextProvider } from "@/components/landing/SiteTextProvider";
import FollowBox from "@/components/listen/FollowBox";
import Listen from "@/components/listen/Listen";
import { langName } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { currentSession } from "@/lib/session";
import { shuffle } from "@/lib/shuffle";
import { fill } from "@/lib/site-text/format";
import { siteText } from "@/lib/site-text";
import { UiTextProvider } from "@/components/UiTextProvider";
import { uiText } from "@/lib/ui-text";
import { followState } from "@/lib/voice-feedback/follow";
import { publicVoices, votesOf } from "@/lib/voice-feedback/public";
import { currentVoter } from "@/lib/voice-feedback/voter";
import "@/components/landing/landing.css";

/**
 * Players' say on the voices designed for a language: open to everyone, signed in or not, so it
 * wears the front page's bar rather than Backstage's. The session and the voter cookie decide
 * which votes are this visitor's own.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const lang = await pageLang(params);
  const t = (await uiText(await readingLang(lang))).listen;
  return { title: `${fill(t.title, { lang: langName(lang) })} · Spoken`, description: t.lede };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await pageLang(params);
  const { followed } = await searchParams;
  // The voices are the same for everyone, so they load while the visitor is worked out.
  const [ui, site, voices, visitor] = await Promise.all([
    readingLang(lang).then(uiText),
    siteText(lang),
    publicVoices(lang),
    currentSession().then(async (session) => {
      const voter = await currentVoter(session?.user.id ?? null);
      const account = session ? { email: session.user.email } : null;
      return Promise.all([voter ? votesOf(lang, voter) : {}, followState(voter, account)]);
    }),
  ]);
  const t = ui.listen;
  const [votes, follow] = visitor;
  return (
    <SiteTextProvider text={site}>
      <UiTextProvider text={ui}>
        <div className={`bn ${display.variable} ${body.variable}`}>
          <LandingHeader t={site} />
          <BackstagePage title={fill(t.title, { lang: langName(lang) })} description={t.lede} width="wide">
            {followed === "1" || followed === "0" ? (
              <p className="vd-note" role="status">
                {followed === "1" ? t.followed : t.followFailed}
              </p>
            ) : null}
            <FollowBox lang={lang} initial={follow} />
            <Listen lang={lang} voices={voices} dealt={shuffle(voices)} votes={votes} />
          </BackstagePage>
        </div>
      </UiTextProvider>
    </SiteTextProvider>
  );
}
