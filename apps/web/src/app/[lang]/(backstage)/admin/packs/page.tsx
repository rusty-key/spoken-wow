import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import PackAdminTable from "@/components/packs/PackAdminTable";
import PackQueue from "@/components/packs/PackQueue";
import { Toaster } from "@/components/ui/toast";
import { Contained, Wide } from "@/components/Width";
import { historyByPack, listAll, queueOf } from "@/lib/community/store";
import { allLangs } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { uiText } from "@/lib/ui-text";
import { namesOf } from "@/lib/users/store";

export const metadata: Metadata = { title: "Community packs · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const words = await uiText(await readingLang(lang));
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();

  const [packs, histories] = await Promise.all([listAll(), historyByPack()]);
  const pending = queueOf(packs);
  const rows = packs.map((pack) => ({ ...pack, history: histories.get(pack.id) ?? [] }));
  // The history holds every submission, the pending ones too.
  const names = await namesOf(
    rows.flatMap((pack) => pack.history.flatMap((submission) => [submission.submittedBy, submission.reviewedBy])),
  );
  const byId = Object.fromEntries(names);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={allLangs()}
        global
        tab="packs"
        pendingPacks={pending.length}
        description={words.packs.adminLede}
      />
      {/* One Toaster for both lists, so their messages stack in one place. */}
      <Toaster>
        <Contained className="pt-6">
          <PackQueue pending={pending} names={byId} />
        </Contained>
        <Contained className="mt-12">
          <h2 className="text-lg font-semibold">{words.packs.allPacks}</h2>
          <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">{words.packs.allLede}</p>
        </Contained>
        <Wide>
          <PackAdminTable packs={rows} names={byId} />
        </Wide>
      </Toaster>
    </main>
  );
}
