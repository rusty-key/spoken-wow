import type { Metadata } from "next";
import { redirect } from "next/navigation";

import BrowserWorker from "@/components/BrowserWorker";
import { Contained } from "@/components/Width";
import { currentSpender } from "@/lib/generation/authz";
import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { readModes } from "@/lib/worker/mode";

export const metadata: Metadata = { title: "Generate here · Spoken" };

export const dynamic = "force-dynamic";

/**
 * Generates the author's queued lines in this tab, for authors without the Spoken Manager.
 * Keys stay in the browser.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await currentSpender();
  if (!session) redirect(localeHref(lang, `/login?next=${encodeURIComponent("/generate")}`));

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Generate in this tab</h1>
        <BrowserWorker initialModes={await readModes(session.user.id)} />
      </Contained>
    </main>
  );
}
