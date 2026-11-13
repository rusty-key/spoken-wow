import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PackList from "@/components/packs/PackList";
import { Contained } from "@/components/Width";
import { listOwned } from "@/lib/community/store";
import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { canSubmitPacks } from "@/lib/permissions";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "My packs · Spoken" };

// Per user, and an admin's decision changes it underneath the page.
export const dynamic = "force-dynamic";

const README = "https://github.com/rusty-key/spoken-wow/blob/master/community/README.md";

/**
 * A pack author's own community packs. A member gets the explainer rather than a 404: the
 * role is asked for, so somebody who found the page needs to know whom to ask.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await currentSession();
  if (!session) redirect(localeHref(lang, "/login"));

  const author = canSubmitPacks(session.user.role);
  const packs = author ? await listOwned(session.user.id) : [];

  return (
    <main className="pt-6 pb-36">
      <Contained>
        {author ? (
          <PackList packs={packs} />
        ) : (
          <>
            <h1 className="text-xl font-semibold">My packs</h1>
            <div className="text-muted-foreground mt-4 max-w-xl space-y-3 text-sm">
              <p>
                A community pack is a voice pack you record or generate yourself. You host the zip on
                your own GitHub releases, and once an admin approves it, players can install it from the
                Spoken Manager.
              </p>
              <p>
                Submitting one needs the <strong className="text-foreground">Pack author</strong> role.
                Ask an admin for it on{" "}
                <a href="/discord" className="text-foreground underline underline-offset-2">
                  Discord
                </a>
                . What a pack must contain is in the{" "}
                <a href={README} className="text-foreground underline underline-offset-2">
                  community pack guide
                </a>
                .
              </p>
            </div>
          </>
        )}
      </Contained>
    </main>
  );
}
