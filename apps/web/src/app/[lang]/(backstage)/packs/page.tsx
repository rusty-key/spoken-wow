import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PackList from "@/components/packs/PackList";
import { Contained } from "@/components/Width";
import { listOwned } from "@/lib/community/store";
import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "My packs · Spoken" };

// Per user, and an admin's decision changes it underneath the page.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await currentSession();
  if (!session) redirect(localeHref(lang, "/login"));

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <PackList packs={await listOwned(session.user.id)} />
      </Contained>
    </main>
  );
}
