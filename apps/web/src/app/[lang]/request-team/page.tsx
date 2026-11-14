import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Link from "@/components/LocaleLink";
import TeamRequestForm from "@/components/TeamRequestForm";
import TeamRequestList from "@/components/TeamRequestList";
import { Contained } from "@/components/Width";
import { languageOptions, localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { currentSession } from "@/lib/session";
import { listRequests } from "@/lib/teams/requests";

export const metadata: Metadata = { title: "Request a team · Spoken" };

export const dynamic = "force-dynamic";

/** Signed-out visitors are sent to sign in, as /profile does. */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await currentSession();
  if (!session) redirect(localeHref(lang, "/login"));

  const requests = await listRequests({ userId: session.user.id });
  const languages = languageOptions();

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Start a team for a language</h1>
        <p className="text-muted-foreground mt-2 mb-8 max-w-xl text-sm">
          A team looks after a language&apos;s text, voices and takes. A site admin approves each
          request. <Link href="/profile" className="text-foreground underline underline-offset-2">Back to your profile</Link>.
        </p>
        <div className="flex flex-col gap-10">
          <TeamRequestList initial={requests} />
          <TeamRequestForm languages={languages} />
        </div>
      </Contained>
    </main>
  );
}
