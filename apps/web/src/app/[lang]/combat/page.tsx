import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Contained } from "@/components/Width";
import { BASE_LANG } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { currentSession } from "@/lib/session";
import { viewerOf } from "@/lib/grants/store";
import { can } from "@/lib/permissions";
import { combatRecordings } from "@/lib/combat/recordings";
import CombatRecordings from "@/components/combat/CombatRecordings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Combat Voice · Spoken" };

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  if (await pageLang(params) !== BASE_LANG) notFound();
  const session = await currentSession();
  if (!session || !can(await viewerOf(session), "regenerate", BASE_LANG)) notFound();
  return <Contained className="space-y-6 py-8">
    <h1 className="text-2xl font-semibold">Combat Voice</h1>
    <p className="text-muted-foreground">Combat voices are selected automatically by your character's race and sex.
      All 16 Classic Era combinations are catalogued; night elf female currently has eight dialogue lines.
      Generate and audition three lines first, then finish the set. Each Generate click spends
      from your active English voice provider using your saved key and settings.</p>
    <CombatRecordings lines={await combatRecordings()} />
  </Contained>;
}
