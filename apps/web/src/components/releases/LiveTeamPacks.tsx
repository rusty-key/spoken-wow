"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useUiText } from "@/components/UiTextProvider";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { langName } from "@/lib/lang";
import type { LiveTeamPack } from "@/lib/releases/sections";
import { fill } from "@/lib/site-text/format";

/**
 * The packs of teams that are not official which players have, each with Delist: it takes the
 * pack off the channel, and the team's next approved release lists it again.
 */
export default function LiveTeamPacks({ packs }: { packs: LiveTeamPack[] }) {
  const t = useUiText().releases;
  return (
    <section aria-labelledby="live-team-packs">
      <h2 id="live-team-packs" className="text-lg font-semibold">
        {t.teamPacksTitle}
      </h2>
      <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">{t.teamPacksLede}</p>
      {packs.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-6 text-sm">{t.noTeamPack}</p>
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
  const words = useUiText();
  const t = words.releases;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const name = fill(t.teamSectionInLang, {
    team: pack.team.name,
    section: words.menu.sectionsNav[pack.section],
    lang: langName(pack.lang),
  });

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
      toast({ tone: "info", title: fill(t.delisting, { name }), detail: t.delistGoes });
    } else {
      const { error } = ((await response?.json().catch(() => ({}))) ?? {}) as { error?: string };
      toast({ tone: "error", title: fill(t.couldNotDelist, { name }), detail: error ?? t.couldNotReach });
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <span className="min-w-48 flex-1">
        <span className="font-medium">{pack.team.name}</span>{" "}
        <span className="text-muted-foreground">
          {fill(t.sectionBeside, { section: words.menu.sectionsNav[pack.section], lang: langName(pack.lang) })}
        </span>
      </span>
      <span className="text-muted-foreground tabular-nums">
        {pack.version && <span className="text-foreground font-mono">v{pack.version}</span>}{" "}
        {fill(t.sinceDate, { date: when(pack.releasedAt, DAY_TIME) })}
      </span>
      {confirming ? (
        <span className="flex gap-2">
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void delist()}>
            {busy ? t.delistingNow : t.delistIt}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            {t.keepIt}
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          {t.delistMore}
        </Button>
      )}
    </li>
  );
}
