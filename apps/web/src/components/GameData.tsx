"use client";

/**
 * /contributions/game-data: the chat commands for a game client, and what its cache says back.
 *
 * Two steps, one per section. The commands make the client fetch every unresolved NPC from its
 * server; the creature cache it writes is read here, in the browser, and only the ids go to
 * api/contributions/game-data for a proposed voice per NPC. Applying posts each chosen one to
 * api/contributions/npc, the same moderator answer the triage table writes, with a note naming
 * the appearance it came from.
 */
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { GameDataProposal } from "@/app/api/contributions/game-data/route";
import { parseCreatureCache } from "@/lib/npc/creature-cache";

type Pending = { npcId: number; npcName: string | null; provenance: string };
type Outcome = "applied" | "failed";

const voiceName = (v: { race: string | null; gender: string | null; flavor: string | null }) =>
  v.race && v.gender ? [v.race, v.gender, v.flavor].filter(Boolean).join("-") : null;

export default function GameData({ pending, script }: { pending: Pending[]; script: string[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ proposals: GameDataProposal[]; cached: number } | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});

  const copy = async (index: number) => {
    await navigator.clipboard.writeText(script[index]).catch(() => null);
    setCopied(index);
  };

  const read = async (file: File) => {
    setError(null);
    setResult(null);
    setOutcomes({});
    setBusy(true);
    try {
      const creatures = parseCreatureCache(await file.arrayBuffer());
      const response = await fetch("/api/contributions/game-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatures }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "That didn't go through -- try again.");
      setResult(body);
      // Preselected: an answer the game gives for an NPC nobody has settled. A settled row is
      // shown for comparison but left alone unless someone ticks it.
      setChosen(
        new Set(
          (body.proposals as GameDataProposal[])
            .filter((p) => p.voice && !p.current.confirmed)
            .map((p) => p.npcId),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setBusy(true);
    for (const proposal of result.proposals) {
      if (!chosen.has(proposal.npcId) || !proposal.voice) continue;
      const response = await fetch("/api/contributions/npc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          npcKind: "creature",
          npcId: proposal.npcId,
          race: proposal.voice.race,
          gender: proposal.voice.gender,
          flavor: proposal.voice.flavor ?? "",
          note: `From the game client: appearance ${proposal.displayId}, ${proposal.reason}.`,
        }),
      }).catch(() => null);
      setOutcomes((current) => ({ ...current, [proposal.npcId]: response?.ok ? "applied" : "failed" }));
    }
    setBusy(false);
  };

  const toggle = (npcId: number, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(npcId);
      else next.delete(npcId);
      return next;
    });

  const inCache = new Set(result?.proposals.map((p) => p.npcId));
  const missing = result ? pending.filter((p) => !inCache.has(p.npcId)) : [];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-medium">1. In the game</h2>
        <p className="text-muted-foreground mt-1 mb-3 text-sm">
          {pending.length} NPCs have no settled speaker. Paste these into the chat box in order,
          wait for the last one to finish printing, then <code>/reload</code> so the client
          writes its cache to disk.
        </p>
        <ol className="flex flex-col gap-2">
          {script.map((line, index) => (
            <li key={index} className="flex items-start gap-2">
              <pre className="bg-muted min-w-0 flex-1 overflow-x-auto rounded px-2 py-1.5 text-xs whitespace-pre-wrap break-all">
                {line}
              </pre>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void copy(index)}>
                {copied === index ? "Copied" : "Copy"}
              </Button>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="font-medium">2. Back here</h2>
        <p className="text-muted-foreground mt-1 mb-3 text-sm">
          Pick <code>creaturecache.wdb</code> from the client&apos;s{" "}
          <code>Cache/WDB/enUS/</code> folder, e.g.{" "}
          <code>World of Warcraft/_forever_/Cache/WDB/enUS/creaturecache.wdb</code>. It is
          read in your browser; only NPC and appearance ids are sent.
        </p>
        <input
          type="file"
          accept=".wdb"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void read(file);
          }}
          className="text-sm"
        />
        {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
      </section>

      {result ? (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {result.cached} creatures in the cache, {result.proposals.length} of them ours.
              {missing.length ? ` ${missing.length} unresolved NPCs were not in it.` : ""}
            </p>
            <Button size="sm" disabled={busy || chosen.size === 0} onClick={() => void apply()}>
              Apply {chosen.size}
            </Button>
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="border-b py-2 font-normal" />
                <th className="border-b py-2 font-normal">NPC</th>
                <th className="border-b py-2 font-normal">Now</th>
                <th className="border-b py-2 font-normal">From the game</th>
                <th className="border-b py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {result.proposals.map((p) => {
                const now = voiceName(p.current);
                const proposed = p.voice ? voiceName(p.voice) : null;
                const same = now === proposed && p.current.confirmed;
                return (
                  <tr key={p.npcId} className="border-b align-top">
                    <td className="py-2 pr-2">
                      <Checkbox
                        checked={chosen.has(p.npcId)}
                        disabled={!p.voice || busy}
                        onCheckedChange={(on) => toggle(p.npcId, on === true)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      {p.npcName ?? "unnamed"} <span className="text-muted-foreground">#{p.npcId}</span>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {now ?? <span className="text-muted-foreground">nothing</span>}{" "}
                      <span className="text-muted-foreground">({p.current.provenance})</span>
                    </td>
                    <td className="py-2 pr-3" title={`appearance ${p.displayId}: ${p.reason}`}>
                      <span className={same ? "text-muted-foreground" : undefined}>
                        {proposed ?? <span className="text-muted-foreground">{p.reason}</span>}
                      </span>
                      {p.voice && !p.exact ? (
                        <Badge variant="outline" className="ml-1 py-0 leading-5" title="The flavor is a default, not the game's">
                          guess
                        </Badge>
                      ) : null}
                      {p.varies ? (
                        <Badge variant="outline" className="ml-1 py-0 leading-5" title="Its appearances do not all share a voice">
                          varies
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {outcomes[p.npcId] === "applied" ? "✓" : outcomes[p.npcId] === "failed" ? "failed" : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {missing.length ? (
            <p className="text-muted-foreground mt-3 text-xs">
              Not in the cache: {missing.map((p) => `${p.npcName ?? "unnamed"} #${p.npcId}`).join(", ")}.
              Run the commands again, or the server does not know them.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
