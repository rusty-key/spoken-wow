import type { Metadata } from "next";
import "../globals.css";
import { Geist } from "next/font/google";
import Image from "next/image";
import Script from "next/script";
import { Suspense } from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { GrantsProvider } from "@/components/GrantsProvider";
import { LangProvider } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import NavigationProgress from "@/components/NavigationProgress";
import SiteHeader from "@/components/SiteHeader";
import UserMenu from "@/components/UserMenu";
import { langTag } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { cn } from "@/lib/utils";
import { Contained } from "@/components/Width";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Spoken",
  description: "Voiced dialogue, lore and text for World of Warcraft Classic",
};

/**
 * The root layout, under the language: every page is in exactly one, and says so in
 * <html lang>.
 *
 * pageLang answers an English page without a query or a session read; only another language
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
  return (
    // Dark-only for now: this is a tool for listening to game dialog, and the light
    // palette is untested. The shadcn tokens make flipping it a one-line change.
    <html lang={langTag(lang)} className={cn("dark font-sans", geist.variable)}>
      <body>
        {/* Suspense because it reads the search params, which would otherwise hold the
            whole page to client rendering. */}
        <Suspense>
          <NavigationProgress />
        </Suspense>
        <LangProvider lang={lang}>
          <GrantsProvider>
            <SiteHeader>
              <header className="border-b">
                <Contained className="flex h-12 items-center justify-between gap-3">
                  <Link href="/" aria-label="Spoken">
                    {/* Intrinsic 1024x187; height is what the header constrains, so the
                        width below is that ratio and only exists to stop the reflow. */}
                    <Image
                      src="/logo.png"
                      alt="Spoken"
                      width={142}
                      height={26}
                      priority
                      className="h-[26px] w-auto"
                    />
                  </Link>
                  <div className="flex items-center gap-1">
                    {/* On a phone the switch lives in UserMenu's burger, with the links. */}
                    <div className="hidden md:block">
                      <LanguageSwitcher />
                    </div>
                    <UserMenu />
                  </div>
                </Contained>
              </header>
            </SiteHeader>
            {children}
          </GrantsProvider>
        </LangProvider>
        {/* Cloudflare Web Analytics. Production only, so local page views don't
            land in the same dashboard as real traffic. */}
        {process.env.NODE_ENV === "production" && (
          <Script
            type="module"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon='{"token": "e4a25ce72fd94bf8a0ed83e1d34c0b1c"}'
          />
        )}
      </body>
    </html>
  );
}
