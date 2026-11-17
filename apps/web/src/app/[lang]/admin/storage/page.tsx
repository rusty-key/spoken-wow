import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import StoragePanel from "@/components/StoragePanel";
import { Contained } from "@/components/Width";
import { viewerOf } from "@/lib/grants/store";
import { isAdmin, langsWhere } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { storageView } from "@/lib/storage/view";
import { freshOwners } from "@/lib/teams/store";

export const metadata: Metadata = { title: "Storage · Spoken" };

export const dynamic = "force-dynamic";

/** A team's own buckets. The language, from `?lang=` as on the release page, names the team. */
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const session = await currentSession();
  const viewer = await viewerOf(session);
  const administered = langsWhere(viewer, "admin");
  if (!session || !viewer || administered.length === 0) notFound();

  const { lang: asked } = await searchParams;
  const lang = administered.find((code) => code === asked) ?? administered[0];
  if (!(await freshOwners([lang])).has(lang)) notFound();

  return (
    <main className="pb-36">
      <AdminHeader
        lang={lang}
        administered={administered}
        global={isAdmin(viewer.role)}
        tab="storage"
        description="Where your team's audio is kept. Connect your own S3-compatible bucket (R2, S3, B2, Wasabi, GCS, MinIO) and send new takes there instead of Spoken's archive."
      />
      <Contained className="pt-6">
        <StoragePanel key={lang} lang={lang} initial={await storageView(lang)} />
      </Contained>
    </main>
  );
}
