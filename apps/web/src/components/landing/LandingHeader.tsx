import Image from "next/image";

import Link from "@/components/LocaleLink";
import type { SiteText } from "@/lib/site-text";

import LanguageSelect from "./LanguageSelect";
import NavMenu from "./NavMenu";
import NavSession from "./NavSession";
import { NAV } from "./nav";

/** The front page's bar. Off the front page its section links lead back to the front page's sections. */
export default function LandingHeader({ t, home = false }: { t: SiteText; home?: boolean }) {
  return (
    <header className="bn-nav">
      <div className="bn-wrap">
        <Link href="/" className="bn-brand" aria-label="Spoken">
          <Image src="/landing/icons/spoken-192.png" alt="" width={96} height={96} priority unoptimized />
          <span className="bn-brand-name bn-display">Spoken</span>
        </Link>
        <nav className="bn-links" aria-label={t.nav.sections}>
          {NAV.map((link) =>
            home ? (
              <a key={link.href} href={link.href}>
                {t.nav[link.key]}
              </a>
            ) : (
              <Link key={link.href} href={`/${link.href}`}>
                {t.nav[link.key]}
              </Link>
            ),
          )}
        </nav>
        <div className="bn-nav-end">
          <LanguageSelect />
          <NavSession />
          <NavMenu home={home} />
        </div>
      </div>
    </header>
  );
}
