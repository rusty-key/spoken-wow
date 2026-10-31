import type { Metadata } from "next";
import { redirect } from "next/navigation";

import BrowserWorker from "@/components/BrowserWorker";
import { Contained } from "@/components/Width";
import { viewerOf } from "@/lib/grants/store";
import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { spendsCredits } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { readModes } from "@/lib/worker/mode";

export const metadata: Metadata = { title: "Generate here · Spoken" };

export const dynamic = "force-dynamic";

/**
 * Generates the author's queued lines in this tab, for authors without the Spoken Manager.
 * Keys stay in the browser.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await currentSession();
  if (!session) redirect(localeHref(lang, `/login?next=${encodeURIComponent("/generate")}`));
  const spends = spendsCredits(await viewerOf(session));

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Generate in this tab</h1>
        {spends ? (
          <BrowserWorker initialModes={await readModes(session.user.id)} />
        ) : (
          // Not sent to /login: signing in again changes nothing, so it would only loop back here.
          <p className="text-muted-foreground mt-4 max-w-xl text-sm">
            Generating audio needs the right to{" "}
            <strong className="text-foreground">regenerate</strong> in a language. Ask an admin,
            or whoever looks after that language, and this page will then generate your queued
            lines.
          </p>
        )}
      </Contained>
    </main>
  );
}
