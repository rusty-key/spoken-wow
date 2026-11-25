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
import { currentSession } from "@/lib/session";
import { readingLang } from "@/lib/lang-server";
import { uiText } from "@/lib/ui-text";

export const metadata: Metadata = { title: "Team releases · Spoken" };

export const dynamic = "force-dynamic";

/** Site owners only, across every language: the versions teams that are not official released. */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) notFound();
  const t = (await uiText(await readingLang((await params).lang))).admin;

  const [waiting, live] = await Promise.all([waitingReviews(), liveTeamPacks()]);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={allLangs()}
        global
        tab="team-releases"
        pendingReleases={waiting.length}
        description={t.teamReleasesLede}
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
