import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ApiKeySection from "@/components/ApiKeySection";
import ApiTokenSection, { type TokenLang } from "@/components/ApiTokenSection";
import Link from "@/components/LocaleLink";
import { apiKeyStatus } from "@/lib/api-key";
import { viewerOf } from "@/lib/grants/store";
import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { langsWhere, roleLabel, spendsCredits } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { listTokens } from "@/lib/tokens/store";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Profile · Spoken" };

// The stored key's state changes underneath this page, and it is per-user, so nothing here
// can be cached between views.
export const dynamic = "force-dynamic";

/**
 * The account's own page.
 *
 * A redirect to /login rather than the 404 /admin and /voices give a member: every signed-in
 * user has a profile, so the only question here is who is asking, and signing in answers it.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await currentSession();
  if (!session) redirect(localeHref(lang, "/login"));

  const role = session.user.role;
  const viewer = await viewerOf(session);
  const spends = spendsCredits(viewer);
  const textLangs = langsWhere(viewer, "text");
  const regenerateLangs = langsWhere(viewer, "regenerate");
  const tokenLangs: TokenLang[] = [...new Set([...textLangs, ...regenerateLangs])].map((code) => ({
    lang: code,
    text: textLangs.includes(code),
    generate: regenerateLangs.includes(code),
  }));
  // The status, never the key. Sent to a client component as props, so this is the shape
  // that decides what the browser can possibly learn.
  const [tokens, status, fishStatus] = await Promise.all([
    tokenLangs.length ? listTokens(session.user.id) : [],
    spends ? apiKeyStatus(session.user.id) : null,
    spends ? apiKeyStatus(session.user.id, "fish") : null,
  ]);

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Profile</h1>

        <dl className="mt-4 mb-8 grid max-w-md grid-cols-[6rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{session.user.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <span className="rounded border px-1.5 text-xs uppercase">{roleLabel(role)}</span>
          </dd>
        </dl>

        <p className="mb-8 text-sm">
          <Link href="/request-team" className="text-foreground underline underline-offset-2">
            Start a team for a language
          </Link>
        </p>

        {spends ? (
          <div className="space-y-10">
            {/* Which one is spent with, and how, is per language on Voices; only the keys,
                which are the account's, live here. */}
            <p className="text-muted-foreground max-w-xl text-sm">
              Choose which generator you use, and set it up, on{" "}
              <Link href="/voices" className="text-foreground underline underline-offset-2">
                Voices
              </Link>
              .
            </p>
            <ApiKeySection initial={status} />
            <ApiKeySection initial={fishStatus} provider="fish" />
          </div>
        ) : (
          // Said rather than hidden: a member who has been told "go and regenerate that line"
          // needs to know which of the two things they are missing.
          <p className="text-muted-foreground max-w-xl text-sm">
            Generating audio needs the right to{" "}
            <strong className="text-foreground">regenerate</strong> in a language. Ask an admin,
            or whoever looks after that language, and this page will then ask you for a key of
            your own.
          </p>
        )}
        {tokenLangs.length > 0 && <ApiTokenSection langs={tokenLangs} initial={tokens} />}
      </Contained>
    </main>
  );
}
