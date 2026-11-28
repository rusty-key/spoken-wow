import Image from "next/image";
import { Suspense } from "react";

import ActingBanner, { actingIn } from "@/components/ActingBanner";
import Link from "@/components/LocaleLink";
import ListenBar from "@/components/ListenBar";
import UserMenu from "@/components/UserMenu";
import { UiTextProvider } from "@/components/UiTextProvider";
import { cjkFace } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { siteText } from "@/lib/site-text";
import { uiText } from "@/lib/ui-text";

/**
 * Every page past the front page. Its words follow readingLang: the signed-in reader's interface
 * language, and the `[lang]` segment only for a signed-out visitor. An admin page's `?lang=` names
 * the team it acts on and never reaches this.
 */
export default async function BackstageLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const lang = await pageLang(params);
  const reading = readingLang(lang);
  const [text, bar, acting] = await Promise.all([reading.then(uiText), reading.then(siteText), actingIn(lang)]);
  const face = cjkFace(await reading);
  return (
    <UiTextProvider text={text}>
      {/* Hoisted to <head>. Only for the reader's interface language, which the address does not carry. */}
      {face && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            rel="stylesheet"
            precedence="cjk"
            href={`https://fonts.googleapis.com/css2?family=Noto+Sans+${face}:wght@100..900&display=swap`}
          />
        </>
      )}
      {/* Only marks the script; backstage.css takes the face from it on body, which reaches the portalled dialogs. */}
      <div className={face ? `ui-cjk-${face.toLowerCase()}` : undefined}>
        <ListenBar text={bar.listenBar.text} cta={bar.listenBar.cta} close={bar.listenBar.close} />
        <header className="bn-theme bn-nav sn">
          <div className="bn-wrap">
            <div className="sn-brand-group">
              <Link href="/" className="bn-brand" aria-label="Spoken">
                <Image src="/landing/icons/spoken-192.png" alt="" width={96} height={96} priority unoptimized />
                <span className="bn-brand-name bn-display">Spoken</span>
              </Link>
              {/* Not waiting for the session: the explorers are public, and the row must not shift. */}
              <span className="sn-area">{text.hub}</span>
            </div>
            <UserMenu />
          </div>
        </header>
        {/* Suspense because the banner's picker reads the search params. */}
        {acting && (
          <Suspense>
            <ActingBanner {...acting} />
          </Suspense>
        )}
        {children}
      </div>
    </UiTextProvider>
  );
}
