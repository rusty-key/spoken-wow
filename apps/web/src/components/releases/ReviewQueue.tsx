"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import LocaleLink from "@/components/LocaleLink";
import { TEXTAREA } from "@/components/packs/common";
import ReleaseReview from "@/components/ReleaseReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { langName, withLang } from "@/lib/lang";
import type { WaitingVersion } from "@/lib/releases/sections";
import { SOURCE_LABELS } from "@/lib/reports/reports";

const MAX_REASON = 500;

async function send(url: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: "Could not reach the server." };
  if (response.ok) return { ok: true };
  const { error } = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: error ?? "Something went wrong." };
}

/**
 * Teams' staged versions waiting for a site owner, oldest first. Each says what it changes for
 * players as its team counts it, opens its lines to read and hear, and is approved or rejected
 * with a reason the team sees.
 */
export default function ReviewQueue({ waiting }: { waiting: WaitingVersion[] }) {
  return (
    <section aria-labelledby="release-queue">
      <h2 id="release-queue" className="flex items-baseline gap-2 text-lg font-semibold">
        Waiting for review
        {waiting.length > 0 && <span className="text-muted-foreground text-sm font-normal tabular-nums">{waiting.length}</span>}
      </h2>
      {waiting.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-6 text-sm">Nothing waiting.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {waiting.map((version) => (
            <QueueItem key={version.id} version={version} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueItem({ version }: { version: WaitingVersion }) {
  const router = useRouter();
  const toast = useToast();
  const when = useLocalDates();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const { pending, team } = version;
  const name = `${team.name}'s ${SOURCE_LABELS[version.section]} in ${langName(version.lang)}`;
  const total = pending.count + pending.textChanges;

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    const result = await send(`/api/releases/${version.id}/review`, action === "reject" ? { action, note: reason.trim() } : { action });
    setBusy(false);
    // Refreshed either way: a 409 means another site owner decided it, and the page should say so.
    router.refresh();
    if (result.ok) {
      setOpen(false);
      toast({
        tone: "info",
        title: action === "approve" ? `Approved ${name}.` : `Did not approve ${name}.`,
        detail: action === "approve" ? "It is listed once its turn comes; the team gets an email then." : "The team gets an email with your reason.",
      });
    } else {
      toast({ tone: "error", title: `Could not ${action} ${name}.`, detail: result.error });
    }
  }

  const actions = rejecting ? (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim()) void decide("reject");
      }}
    >
      <Label htmlFor={`reason-${version.id}`}>Why it is not approved</Label>
      <textarea
        id={`reason-${version.id}`}
        rows={3}
        maxLength={MAX_REASON}
        required
        autoFocus
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={busy}
        aria-describedby={`reason-${version.id}-help`}
        className={TEXTAREA}
      />
      <p id={`reason-${version.id}-help`} className="text-muted-foreground text-xs">
        The team sees this on its release page and gets it by email, so say what to fix.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
          <X aria-hidden />
          {busy ? "Rejecting…" : "Reject"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
          Cancel
        </Button>
      </div>
    </form>
  ) : (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || version.approving} onClick={() => void decide("approve")}>
        <Check aria-hidden />
        {version.approving ? "Being listed…" : busy ? "Approving…" : "Approve"}
      </Button>
      <Button variant="outline" disabled={busy || version.approving} onClick={() => setRejecting(true)}>
        Reject…
      </Button>
    </div>
  );

  return (
    <li className="bg-card rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{team.name}</span>
        <Badge variant="outline">{version.lang}</Badge>
        <span className="text-muted-foreground text-xs">{SOURCE_LABELS[version.section]}</span>
        {version.version && <span className="ml-auto font-mono text-xs">v{version.version}</span>}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        Pressed by <span className="text-foreground">{version.by ?? "someone unnamed"}</span> on{" "}
        {when(version.pressedAt, DAY_TIME)}
      </p>
      <p className="mt-3 text-sm">
        {total === 0 ? (
          <span className="text-muted-foreground">No line counted since the team&apos;s last approved release.</span>
        ) : (
          <>
            <span className="text-primary-ink font-semibold tabular-nums">
              {pending.count.toLocaleString()} {pending.count === 1 ? "line" : "lines"}
            </span>
            <span className="text-muted-foreground">
              {pending.since ? ` new or changed since ${when(pending.since, DAY_TIME)}` : " · the team's first release"}
              {pending.textChanges > 0 && ` · ${pending.textChanges.toLocaleString()} text changes`}
              {pending.people.length > 0 && ` · by ${pending.people.map((person) => person.name ?? "unnamed").join(", ")}`}
            </span>
          </>
        )}
      </p>
      {version.error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {version.error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Button variant="link" className="h-auto px-0" onClick={() => setOpen(true)}>
          Read and listen
        </Button>
        <LocaleLink
          href={withLang(version.lang, `/${version.section}?team=${encodeURIComponent(team.slug)}`)}
          className="text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          Open in the explorer
        </LocaleLink>
      </div>
      <div className="mt-4">{actions}</div>
      <ReleaseReview
        open={open}
        onOpenChange={setOpen}
        section={version.section}
        lang={version.lang}
        pending={pending}
        version={version.version}
        bumpable={false}
        onRelease={() => {}}
        reviewed={{ runId: version.id, team, actions }}
      />
    </li>
  );
}
