"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { fill } from "@/lib/site-text/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { decideSubmission } from "@/lib/community/admin-client";
import type { PackFields } from "@/lib/community/rules";
import type { Pack, Submission } from "@/lib/community/store";
import { cn } from "@/lib/utils";

import { nameOf, TEXTAREA } from "./common";

type Pending = Submission & { pack: Pack };

const MAX_REASON = 500;

const link = (value: string) => (
  <a
    href={value}
    className="text-foreground underline underline-offset-2 [overflow-wrap:anywhere] hover:text-primary-ink"
    target="_blank"
    rel="noreferrer"
  >
    {value}
  </a>
);

function sizeOf(bytes: number): string {
  const mib = bytes / 1024 ** 2;
  const readable = mib >= 1024 ? `${(mib / 1024).toFixed(2)} GiB` : `${mib.toFixed(1)} MiB`;
  return `${bytes.toLocaleString("en-US")} bytes (${readable})`;
}

type FieldKey = keyof PackFields;
const FIELD_KEYS: FieldKey[] = ["title", "author", "description", "version", "size", "sha256", "url", "homepage", "license"];
const SHOWN: Partial<Record<FieldKey, (value: string) => ReactNode>> = {
  description: (value) => <span className="whitespace-pre-wrap">{value}</span>,
  version: (value) => <span className="font-mono">{value}</span>,
  size: (value) => <span className="tabular-nums">{sizeOf(Number(value))}</span>,
  sha256: (value) => <span className="font-mono text-xs [overflow-wrap:anywhere]">{value}</span>,
  url: link,
  homepage: link,
};

function Value({ field, value, none }: { field: FieldKey; value: string | number | null; none: string }) {
  if (value === null || value === "") return <span className="text-muted-foreground">{none}</span>;
  const show = SHOWN[field];
  return show ? show(String(value)) : <>{value}</>;
}

/**
 * Submissions waiting for review, oldest first, each with what it would change.
 *
 * An update is shown against the live version field by field, because what an admin has to
 * judge is the difference: a new zip and checksum are expected, a new author or link is the
 * thing worth a second look.
 */
export default function PackQueue({ pending, names }: { pending: Pending[]; names: Record<string, string> }) {
  const t = useUiText().packs.admin;
  return (
    <section aria-labelledby="pack-queue">
      <h2 id="pack-queue" className="flex items-baseline gap-2 text-lg font-semibold">
        {t.queueTitle}
        {pending.length > 0 && (
          <span className="text-muted-foreground text-sm font-normal tabular-nums">{pending.length}</span>
        )}
      </h2>
      {pending.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-6 text-sm">{t.nothingWaiting}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {pending.map((submission) => (
            <QueueItem key={submission.id} submission={submission} names={names} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueItem({ submission, names }: { submission: Pending; names: Record<string, string> }) {
  const text = useUiText().packs;
  const t = text.admin;
  const router = useRouter();
  const toast = useToast();
  const when = useLocalDates();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const { pack } = submission;
  const live = pack.live;
  const submitter = nameOf(submission.submittedBy, submission.submittedBy && names[submission.submittedBy]);
  const name = `${submission.title} ${submission.version}`;

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const result = await decideSubmission(submission.id, decision, decision === "reject" ? reason.trim() : undefined);
    setBusy(false);
    // Refreshed either way: a 409 means another admin decided it, and the page should say so.
    router.refresh();
    if (result.ok) {
      toast({
        tone: "info",
        title: fill(decision === "approve" ? t.approved : t.rejectedIt, { name }),
        detail: t.authorEmailed,
      });
    } else {
      toast({
        tone: "error",
        title: fill(t.couldNot, { decision, name }),
        detail: result.error,
      });
    }
  }

  return (
    <li className="bg-card rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{submission.title}</span>
        <span className="text-muted-foreground font-mono text-xs">{pack.id}</span>
        <Badge variant="outline">{pack.lang}</Badge>
        <span className="text-muted-foreground text-xs">{pack.section}</span>
        <span className="ml-auto text-xs">
          {live ? (
            <span className="text-muted-foreground">
              {t.updateFrom} <span className="font-mono">v{live.version}</span>
            </span>
          ) : (
            <span className="text-primary-ink">{text.newPack}</span>
          )}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        {fill(t.submittedByOn, { name: submitter, when: when(submission.submittedAt, DAY_TIME) })}
        {!pack.listed && t.unlistedNote}
      </p>

      <dl className="mt-4 text-sm">
        {live && (
          <div className="text-muted-foreground hidden grid-cols-[7rem_1fr_1fr] gap-x-4 pb-1 text-xs sm:grid">
            <span />
            <span>{t.liveColumn}</span>
            <span>{t.submittedColumn}</span>
          </div>
        )}
        {FIELD_KEYS.map((field) => {
          const now = submission[field];
          const before = live?.[field] ?? null;
          const changed = live !== null && (before ?? "") !== (now ?? "");
          return (
            <div
              key={field}
              className={cn(
                "grid gap-x-4 gap-y-0.5 rounded-md px-2 py-1.5 -mx-2",
                live ? "sm:grid-cols-[7rem_1fr_1fr]" : "sm:grid-cols-[7rem_1fr]",
                changed && "bg-primary/10",
              )}
            >
              <dt className="text-muted-foreground flex items-baseline gap-1.5 text-xs sm:pt-0.5">
                {t.status[field as keyof typeof t.status]}
                {changed && <span className="text-primary-ink font-medium">{t.changed}</span>}
              </dt>
              {live && (
                <dd className={cn("min-w-0", changed && "text-muted-foreground")}>
                  <span className="text-muted-foreground mr-1.5 text-xs sm:hidden">{t.liveColumn}:</span>
                  <Value field={field} value={before} none={t.none} />
                </dd>
              )}
              <dd className="min-w-0">
                {live && (
                  <span className="text-muted-foreground mr-1.5 text-xs sm:hidden">
                    {t.submittedColumn}:
                  </span>
                )}
                <Value field={field} value={now} none={t.none} />
              </dd>
            </div>
          );
        })}
      </dl>

      {rejecting ? (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) void decide("reject");
          }}
        >
          <Label htmlFor={`reason-${submission.id}`}>{t.whyNotApproved}</Label>
          <textarea
            id={`reason-${submission.id}`}
            rows={3}
            maxLength={MAX_REASON}
            required
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            aria-describedby={`reason-${submission.id}-help`}
            className={TEXTAREA}
          />
          <p id={`reason-${submission.id}-help`} className="text-muted-foreground text-xs">
            {t.whyHint}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
              <X aria-hidden />
              {busy ? t.rejecting : t.reject}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
              {t.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void decide("approve")}>
            <Check aria-hidden />
            {busy ? t.approving : t.approve}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            {t.rejectEllipsis}
          </Button>
        </div>
      )}
    </li>
  );
}
