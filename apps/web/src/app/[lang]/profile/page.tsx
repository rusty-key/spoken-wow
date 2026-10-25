import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ApiKeySection from "@/components/ApiKeySection";
import GenerationModeSection from "@/components/GenerationModeSection";
import Link from "@/components/LocaleLink";
import { apiKeyStatus } from "@/lib/api-key";
import { viewerOf } from "@/lib/grants/store";
import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { spendsCredits } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { Contained } from "@/components/Width";
import { readModes } from "@/lib/worker/mode";
import { listTokens, normaliseCode } from "@/lib/worker/tokens";

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
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ pair?: string | string[] }>;
}) {
  const lang = await pageLang(params);
  const session = await currentSession();
  // A Spoken Manager sends its owner here to approve its pairing code; signing in keeps it.
  const pair = (await searchParams).pair;
  const pairCode = typeof pair === "string" && pair ? normaliseCode(pair) : null;
  if (!session) {
    redirect(localeHref(lang, pairCode ? `/login?next=${encodeURIComponent(`/profile?pair=${pairCode}`)}` : "/login"));
  }

  const role = session.user.role;
  const spends = spendsCredits(await viewerOf(session));
  // The status, never the key. Sent to a client component as props, so this is the shape
  // that decides what the browser can possibly learn.
  const [status, fishStatus] = spends
    ? await Promise.all([apiKeyStatus(session.user.id), apiKeyStatus(session.user.id, "fish")])
    : [null, null];
  const [modes, managers] = spends
    ? await Promise.all([readModes(session.user.id), listTokens(session.user.id)])
    : [null, []];

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Profile</h1>

        <dl className="mt-4 mb-8 grid max-w-md grid-cols-[6rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{session.user.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <span className="rounded border px-1.5 text-xs uppercase">{role ?? "member"}</span>
          </dd>
        </dl>

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
            {modes ? (
              <GenerationModeSection initialModes={modes} initialManagers={managers} pairCode={pairCode} />
            ) : null}
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
      </Contained>
    </main>
  );
}
