import type { Metadata } from "next";
import "../globals.css";
import "@/components/landing/brand.css";
import "@/components/site-nav.css";
import localFont from "next/font/local";
import Image from "next/image";
import Script from "next/script";
import { Suspense } from "react";
import { GrantsProvider } from "@/components/GrantsProvider";
import { LangProvider } from "@/components/LangProvider";
import { LanguagesProvider } from "@/components/LanguagesProvider";
import Link from "@/components/LocaleLink";
import NavigationProgress from "@/components/NavigationProgress";
import SiteHeader from "@/components/SiteHeader";
import UserMenu from "@/components/UserMenu";
import { langTag, registeredExtras } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { cn } from "@/lib/utils";
import { body, display } from "@/components/landing/fonts";

// The whole font rather than a subset: Russian pages render in it too.
const geist = localFont({ src: "../../fonts/geist-sans.woff2", weight: "100 900", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Spoken",
  description: "Voiced dialogue, lore and text for World of Warcraft Classic",
};

/**
 * The root layout, under the language: every page is in exactly one, and says so in
 * <html lang>.
 *
 * pageLang answers an English page without a query or a session read, and the language list for
 * the browser comes from the in-memory registry; only another language
 * asks whether it is switched on, and whether the visitor is an admin who may see it early.
 *
 * NOTHING HERE IS PRERENDERED, including the four English pages that were (the landing page,
 * /quests, /login and /register). A generateStaticParams for English would keep them static,
 * but it also makes Next render every other language as a static page on first request, and
 * the admin check above reads the session -- which a static render may not, and which fails
 * as a 500 at runtime rather than at build. Those four pages do no database work for English,
 * so rendering them per request costs a React render and nothing else.
 */
export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const lang = await pageLang(params);
  // From the registry, never the database: it is filled at boot and on every change, and pageLang
  // has already awaited a load for a non-English page. An English page therefore renders with the
  // database down. Only the languages beyond the built-in ones travel to the browser.
  const extras = registeredExtras();
  return (
    // Dark-only for now: this is a tool for listening to game dialog, and the light
    // palette is untested. The shadcn tokens make flipping it a one-line change.
    <html lang={langTag(lang)} className={cn("dark font-sans", geist.variable, display.variable, body.variable)}>
      <body>
        {/* Suspense because it reads the search params, which would otherwise hold the
            whole page to client rendering. */}
        <Suspense>
          <NavigationProgress />
        </Suspense>
        <LanguagesProvider languages={extras}>
          <LangProvider lang={lang}>
            <GrantsProvider>
              <SiteHeader>
                <header className="bn-theme bn-nav sn">
                  <div className="bn-wrap sn-row">
                    <Link href="/" className="bn-brand" aria-label="Spoken">
                      <Image src="/landing/icons/spoken-192.png" alt="" width={96} height={96} priority unoptimized />
                      <span className="bn-brand-name bn-display">Spoken</span>
                    </Link>
                    {/* The front page's "Backstage" button leads here: this tag says you arrived. */}
                    <span className="sn-area">Backstage</span>
                    <UserMenu />
                  </div>
                </header>
              </SiteHeader>
              {children}
            </GrantsProvider>
          </LangProvider>
        </LanguagesProvider>
        {/* Cloudflare Web Analytics and Ahrefs Analytics. Production only, so local page
            views don't land in the same dashboards as real traffic. */}
        {process.env.NODE_ENV === "production" && (
          <>
            <Script
              type="module"
              src="https://static.cloudflareinsights.com/beacon.min.js"
              data-cf-beacon='{"token": "e4a25ce72fd94bf8a0ed83e1d34c0b1c"}'
            />
            <Script
              src="https://analytics-staging.ahrefs.dev/analytics.js"
              data-key="ptQ75WOQAU3T/ui1ab/faA"
              strategy="afterInteractive"
            />
          </>
        )}
      </body>
    </html>
  );
}
