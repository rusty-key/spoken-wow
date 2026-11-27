import Image from "next/image";
import { Suspense } from "react";

import ActingBanner, { actingIn } from "@/components/ActingBanner";
import Link from "@/components/LocaleLink";
import ListenBar from "@/components/ListenBar";
import UserMenu from "@/components/UserMenu";
import { UiTextProvider } from "@/components/UiTextProvider";
import { pageLang, readingLang } from "@/lib/lang-server";
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
  const [text, acting] = await Promise.all([readingLang(lang).then(uiText), actingIn(lang)]);
  return (
    <UiTextProvider text={text}>
      <ListenBar text={text.listen.barText} cta={text.listen.barCta} close={text.listen.barClose} />
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
    </UiTextProvider>
  );
}
