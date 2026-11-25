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
import { useUiText } from "@/components/UiTextProvider";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { langName, withLang } from "@/lib/lang";
import type { WaitingVersion } from "@/lib/releases/sections";
import { fill } from "@/lib/site-text/format";
import type { UiText } from "@/lib/ui-text/en";

const MAX_REASON = 500;

type Words = UiText["releases"];

async function send(url: string, body: unknown, words: Words): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: words.couldNotReach };
  if (response.ok) return { ok: true };
  const { error } = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: error ?? words.wentWrong };
}

/**
 * Teams' staged versions waiting for a site owner, oldest first. Each says what it changes for
 * players as its team counts it, opens its lines to read and hear, and is approved or rejected
 * with a reason the team sees.
 */
export default function ReviewQueue({ waiting }: { waiting: WaitingVersion[] }) {
  const t = useUiText().releases;
  return (
    <section aria-labelledby="release-queue">
      <h2 id="release-queue" className="flex items-baseline gap-2 text-lg font-semibold">
        {t.waitingForReview}
        {waiting.length > 0 && <span className="text-muted-foreground text-sm font-normal tabular-nums">{waiting.length}</span>}
      </h2>
      {waiting.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-6 text-sm">{t.nothingWaiting}</p>
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
  const words = useUiText();
  const t = words.releases;
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const { pending, team } = version;
  const name = fill(t.teamSectionInLang, {
    team: team.name,
    section: words.menu.sectionsNav[version.section],
    lang: langName(version.lang),
  });
  const total = pending.count + pending.textChanges;

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    const result = await send(
      `/api/releases/${version.id}/review`,
      action === "reject" ? { action, note: reason.trim() } : { action },
      t,
    );
    setBusy(false);
    // Refreshed either way: a 409 means another site owner decided it, and the page should say so.
    router.refresh();
    if (result.ok) {
      setOpen(false);
      toast({
        tone: "info",
        title: action === "approve" ? fill(t.approved, { name }) : fill(t.didNotApprove, { name }),
        detail: action === "approve" ? t.approvedDetail : t.didNotApproveDetail,
      });
    } else {
      toast({ tone: "error", title: fill(action === "approve" ? t.couldNotApprove : t.couldNotReject, { name }), detail: result.error });
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
      <Label htmlFor={`reason-${version.id}`}>{t.whyNotApproved}</Label>
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
        {t.reasonHelp}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
          <X aria-hidden />
          {busy ? t.rejecting : t.reject}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
          {words.common.cancel}
        </Button>
      </div>
    </form>
  ) : (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || version.approving} onClick={() => void decide("approve")}>
        <Check aria-hidden />
        {version.approving ? t.beingListed : busy ? t.approving : t.approve}
      </Button>
      <Button variant="outline" disabled={busy || version.approving} onClick={() => setRejecting(true)}>
        {t.rejectMore}
      </Button>
    </div>
  );

  return (
    <li className="bg-card rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{team.name}</span>
        <Badge variant="outline">{version.lang}</Badge>
        <span className="text-muted-foreground text-xs">{words.menu.sectionsNav[version.section]}</span>
        {version.version && <span className="ml-auto font-mono text-xs">v{version.version}</span>}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        {t.pressedByBefore}
        <span className="text-foreground">{version.by ?? t.someoneUnnamed}</span>
        {t.pressedByAfter}
        {when(version.pressedAt, DAY_TIME)}
      </p>
      <p className="mt-3 text-sm">
        {total === 0 ? (
          <span className="text-muted-foreground">{t.noneSinceApproved}</span>
        ) : (
          <>
            <span className="text-primary-ink font-semibold tabular-nums">
              {fill(pending.count === 1 ? t.lineOne : t.lineMany, { n: pending.count.toLocaleString() })}
            </span>
            <span className="text-muted-foreground">
              {pending.since ? fill(t.newOrChangedSince, { date: when(pending.since, DAY_TIME) }) : t.firstRelease}
              {pending.textChanges > 0 && fill(t.textChanges, { n: pending.textChanges.toLocaleString() })}
              {pending.people.length > 0 &&
                fill(t.byPeople, { people: pending.people.map((person) => person.name ?? t.unnamed).join(", ") })}
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
          {t.readAndListen}
        </Button>
        <LocaleLink
          href={withLang(version.lang, `/${version.section}?team=${encodeURIComponent(team.slug)}`)}
          className="text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {t.openInExplorer}
        </LocaleLink>
      </div>
      {/* One form at a time: the dialog's carries the same ids, which the card's would take. */}
      {!open && <div className="mt-4">{actions}</div>}
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
