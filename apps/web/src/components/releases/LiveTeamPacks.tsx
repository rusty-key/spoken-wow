"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { langName } from "@/lib/lang";
import type { LiveTeamPack } from "@/lib/releases/sections";
import { SOURCE_LABELS } from "@/lib/reports/reports";

/**
 * The packs of teams that are not official which players have, each with Delist: it takes the
 * pack off the channel, and the team's next approved release lists it again.
 */
export default function LiveTeamPacks({ packs }: { packs: LiveTeamPack[] }) {
  return (
    <section aria-labelledby="live-team-packs">
      <h2 id="live-team-packs" className="text-lg font-semibold">
        Team packs on the channel
      </h2>
      <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">
        A delisted pack leaves the Manager and keeps its files. The team sees it was delisted, and its next
        approved release lists it again. An official team&apos;s packs are not listed here.
      </p>
      {packs.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-6 text-sm">No team pack is listed.</p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border">
          {packs.map((pack) => (
            <PackRow key={`${pack.team.id}:${pack.lang}:${pack.section}`} pack={pack} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PackRow({ pack }: { pack: LiveTeamPack }) {
  const router = useRouter();
  const toast = useToast();
  const when = useLocalDates();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const name = `${pack.team.name}'s ${SOURCE_LABELS[pack.section]} in ${langName(pack.lang)}`;

  async function delist() {
    setBusy(true);
    const response = await fetch("/api/releases/delist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team: pack.team.id, lang: pack.lang, section: pack.section }),
    }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    router.refresh();
    if (response?.ok) {
      toast({ tone: "info", title: `Delisting ${name}.`, detail: "It leaves the channel once its turn comes." });
    } else {
      const { error } = ((await response?.json().catch(() => ({}))) ?? {}) as { error?: string };
      toast({ tone: "error", title: `Could not delist ${name}.`, detail: error ?? "Could not reach the server." });
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <span className="min-w-48 flex-1">
        <span className="font-medium">{pack.team.name}</span>{" "}
        <span className="text-muted-foreground">
          · {SOURCE_LABELS[pack.section]} in {langName(pack.lang)}
        </span>
      </span>
      <span className="text-muted-foreground tabular-nums">
        {pack.version && <span className="text-foreground font-mono">v{pack.version}</span>} since {when(pack.releasedAt, DAY_TIME)}
      </span>
      {confirming ? (
        <span className="flex gap-2">
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void delist()}>
            {busy ? "Delisting…" : "Delist it"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          Delist…
        </Button>
      )}
    </li>
  );
}
