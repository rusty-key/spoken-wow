import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import TeamDashboard from "@/components/TeamDashboard";
import { Contained } from "@/components/Width";
import { dashboard } from "@/lib/admin/dashboard";
import { viewerOf } from "@/lib/grants/store";
import { langName } from "@/lib/lang";
import { can, isAdmin, langsWhere, type Capability } from "@/lib/permissions";
import { queuesOf, triages } from "@/lib/reports/reports";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard · Spoken" };

export const dynamic = "force-dynamic";

/**
 * What waits in one language the viewer looks after, each count linking to the page that
 * handles it. Gated like /admin, a 404 for anybody who is admin nowhere; the language comes
 * from `?lang=`, the first one administered when absent.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const session = await currentSession();
  const viewer = await viewerOf(session);
  const administered = langsWhere(viewer, "admin");
  if (!session || !viewer || administered.length === 0) notFound();

  const { lang: asked } = await searchParams;
  const lang = administered.find((code) => code === asked) ?? administered[0];
  const may = (capability: Capability) => can(viewer, capability, lang);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={lang}
        administered={administered}
        global={isAdmin(viewer.role)}
        tab="dashboard"
        description={`What is waiting in ${langName(lang)}, and who on the team can pick it up.`}
      />
      <Contained className="pt-6">
        <TeamDashboard
          lang={lang}
          data={await dashboard(lang, queuesOf(viewer, lang))}
          // A link only where its page would let the viewer in, so none leads to a 404.
          access={{ contributions: may("text"), reports: triages(may), missing: may("edit"), activity: may("admin") }}
        />
      </Contained>
    </main>
  );
}
