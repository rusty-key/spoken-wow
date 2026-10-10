import type { Metadata } from "next";
import { headers } from "next/headers";

import ContributeForm from "@/components/ContributeForm";
import UploadBroadcastCache from "@/components/UploadBroadcastCache";
import UploadGathered from "@/components/UploadGathered";
import { auth } from "@/lib/auth";
import { pageLang } from "@/lib/lang-server";
import { Contained } from "@/components/Width";

/**
 * Where the addons send a player when there is no audio for a quest, book page or place.
 *
 * The address every addon's Contribute link points at -- spoken.rusty.one/contribute#e1=... --
 * so it has to work with nothing but what the link carries: most of the people who reach it
 * have no account here, and never will.
 *
 * The session is read only to decide whether to ASK for a name. Someone signed in has already
 * answered that question, and the route takes their identity from the session regardless of
 * what the form sends, so showing them the fields would be offering a choice that does not
 * exist. Reading it is also why this page cannot be static.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contribute · Spoken",
  description: "Send the game's own text for something Spoken has no narration for yet.",
};

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  // The name if they have one, the email otherwise: better to say "Filed as you@example.com"
  // than "Filed as ." for an account that never set a display name.
  const signedInAs = session ? (session.user.name?.trim() || session.user.email) : null;

  return (
    <main className="pt-8 pb-24">
      <Contained>
        <article className="max-w-xl">
          <h1 className="text-xl font-semibold">Contribute</h1>
          <p className="text-muted-foreground mt-1 mb-6 text-sm">
            Send the game&apos;s text for what Spoken hasn&apos;t narrated yet. A person reviews
            every line, so answers take a while.
          </p>

          <ContributeForm signedInAs={signedInAs} />
        </article>

        {/* Below the single-line form, not instead of it: most arrivals come from a link, and
            the files are for players willing to dig in the game's folder. */}
        <div className="mt-10 grid gap-10 md:grid-cols-2">
          <Section title="Everything you gathered">
            <p className="text-muted-foreground text-sm">
              Every line the addon collected while you played.
            </p>
            <Step n={1}>
              Turn on <strong>Gather as I play</strong> in the game, then log out or{" "}
              <code>/reload</code>.
            </Step>
            <Step n={2}>Drop this file below:</Step>
            <Path>
              World of Warcraft/&lt;game folder&gt;/WTF/Account/&lt;account&gt;/SavedVariables/
              <strong className="text-foreground whitespace-nowrap">SpokenContributions.lua</strong>
            </Path>
            <UploadGathered signedInAs={signedInAs} />
          </Section>

          <Section title="Game text cache">
            <p className="text-muted-foreground text-sm">
              Helps match NPC greetings across languages. Only NPC text is sent.
            </p>
            <Step n={1}>Log out of the game.</Step>
            <Step n={2}>
              Drop <FileName>DBCache.bin</FileName> and every <FileName>DBCache.*.tmp</FileName>{" "}
              file from this folder, and pick its language:
            </Step>
            <Path>
              World of Warcraft/&lt;game folder&gt;/Cache/ADB/
              <strong className="text-foreground whitespace-nowrap">&lt;language&gt;</strong>/
            </Path>
            <UploadBroadcastCache signedIn={session !== null} lang={lang} />
          </Section>
        </div>
      </Contained>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-sm">
      <span className="text-muted-foreground tabular-nums">{n}.</span>
      <span>{children}</span>
    </p>
  );
}

/** A path to copy out of the game's folder: set apart, so it is found at a glance. */
function Path({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted text-muted-foreground block rounded px-3 py-2 font-mono text-xs break-all">
      {children}
    </code>
  );
}

/** A file the player has to find, standing out from the sentence around it. */
function FileName({ children }: { children: React.ReactNode }) {
  return <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-xs font-semibold">{children}</code>;
}
