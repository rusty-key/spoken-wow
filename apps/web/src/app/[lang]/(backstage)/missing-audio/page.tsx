import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Contained } from "@/components/Width";
import { auth } from "@/lib/auth";
import { missingAudioRanking } from "@/lib/contributions/missing-audio";
import { viewerOf } from "@/lib/grants/store";
import { langName, localeHref } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { uiText } from "@/lib/ui-text";
import { fill } from "@/lib/site-text/format";
import { explorerHref } from "@/lib/links";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Missing audio · Spoken" };

export const dynamic = "force-dynamic";

/**
 * Lines players heard in silence, most players first: what the Spoken Manager counts when its
 * player turned Sharing on (lib/contributions/missing-audio.ts). Read only. Queueing a line is
 * the explorer's flow, which each row links to.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });
  // 404, as /contributions: the counts are per install, and only a collaborator acts on them.
  const viewer = await viewerOf(session);
  if (!session || !can(viewer, "edit", lang)) notFound();

  const rows = await missingAudioRanking(lang);
  const t = (await uiText(await readingLang(lang))).missingAudio;

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">{fill(t.lede, { lang: langName(lang) })}</p>
        {rows.length === 0 ? (
          <p className="text-sm">{t.nothing}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-3 font-medium">{t.players}</th>
                <th className="py-1 pr-3 font-medium">{t.line}</th>
                <th className="py-1 pr-3 font-medium">{t.text}</th>
                <th className="py-1 pr-3 font-medium">{t.state}</th>
                <th className="py-1 font-medium">{t.packVersions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lineId} className="border-t align-top">
                  <td className="py-1 pr-3 tabular-nums">{row.installs}</td>
                  <td className="py-1 pr-3 font-mono whitespace-nowrap">
                    <Link
                      className="underline"
                      href={localeHref(lang, explorerHref(row.lineId.startsWith("b:") ? "readables" : "quests", row.lineId))}
                    >
                      {row.lineId}
                    </Link>
                  </td>
                  <td className="py-1 pr-3">{row.text ? row.text.slice(0, 160) : "—"}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{row.voiced ? t.voicedHere : t.notVoiced}</td>
                  <td className="py-1 font-mono">{row.packVersions.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Contained>
    </main>
  );
}
