import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import PackAdminTable from "@/components/packs/PackAdminTable";
import PackQueue from "@/components/packs/PackQueue";
import { Toaster } from "@/components/ui/toast";
import { Contained, Wide } from "@/components/Width";
import { history, listAll, listPending } from "@/lib/community/store";
import { CODES } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { namesOf } from "@/lib/users/store";

export const metadata: Metadata = { title: "Community packs · Spoken" };

export const dynamic = "force-dynamic";

/** The review queue for community packs, and every pack there is. Site admins only; a 404 for anyone else. */
export default async function Page() {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();

  const [pending, packs] = await Promise.all([listPending(), listAll()]);
  const histories = await Promise.all(packs.map((pack) => history(pack.id)));
  const names = await namesOf([
    ...pending.map((submission) => submission.submittedBy),
    ...histories.flat().flatMap((submission) => [submission.submittedBy, submission.reviewedBy]),
  ]);
  const byId = Object.fromEntries(names);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={CODES}
        global
        tab="packs"
        pendingPacks={pending.length}
        description="Voice packs that authors host on their own GitHub releases. Nothing reaches the Spoken Manager until you approve it, and each new version waits for you again."
      />
      {/* One Toaster for both lists, so their messages stack in one place. */}
      <Toaster>
        <Contained className="pt-6">
          <PackQueue pending={pending} names={byId} />
        </Contained>
        <Contained className="mt-12">
          <h2 className="text-lg font-semibold">All packs</h2>
          <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">
            An unlisted pack leaves the Manager&apos;s list and keeps its versions, so listing it again
            brings back the live one. The owner is the account that may submit its next version.
          </p>
        </Contained>
        <Wide>
          <PackAdminTable packs={packs.map((pack, index) => ({ ...pack, history: histories[index] }))} names={byId} />
        </Wide>
      </Toaster>
    </main>
  );
}
