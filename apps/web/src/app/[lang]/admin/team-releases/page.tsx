import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import LiveTeamPacks from "@/components/releases/LiveTeamPacks";
import ReviewQueue from "@/components/releases/ReviewQueue";
import { Toaster } from "@/components/ui/toast";
import { Contained } from "@/components/Width";
import { allLangs } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import { liveTeamPacks, waitingReviews } from "@/lib/releases/review";
import { syncActive } from "@/lib/releases/sync";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Team releases · Spoken" };

export const dynamic = "force-dynamic";

/** Site owners only, across every language: the versions teams that are not official released. */
export default async function Page() {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();

  // A promotion or delisting that finished shows as such, not as still being listed.
  await syncActive();
  const [waiting, live] = await Promise.all([waitingReviews(), liveTeamPacks()]);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={allLangs()}
        global
        tab="team-releases"
        pendingReleases={waiting.length}
        description="A release of a team that is not official builds and uploads its packs, then waits here. Nothing reaches the Spoken Manager until you approve it, and each new version waits for you again."
      />
      {/* One Toaster for both lists, so their messages stack in one place. */}
      <Toaster>
        <Contained className="pt-6">
          <ReviewQueue waiting={waiting} />
        </Contained>
        <Contained className="mt-12">
          <LiveTeamPacks packs={live} />
        </Contained>
      </Toaster>
    </main>
  );
}
