"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Estimate } from "@/lib/generation/billing";
import type { BatchSkip, GenerationStatusResponse } from "@/lib/generation/client";
import { usd } from "@/lib/generation/money";

function n(value: number): string {
  return value.toLocaleString();
}

/** Each reason a matched line is not a job of its own, worded for the dialog. */
const SKIP_REASONS: [BatchSkip, string][] = [
  ["no-voice", "no voice"],
  ["untranslated", "not translated"],
  ["invalid-chars", "unspeakable characters ($, < or >)"],
  ["progress", "quest progress text, never voiced"],
  ["shared-file", "same audio file as another line, generated once"],
];

export type PendingBatch = {
  label: string;
  /** Null while the set is still being fetched, so the dialog opens on the click. */
  estimate: Estimate | null;
  /**
   * The lines of voices pinned to fish.audio, priced in its dollars apart from `estimate`,
   * which then holds the rest. Null or absent when the batch has none.
   */
  pinnedEstimate?: Estimate | null;
  /** The fetch failed, which the dialog says rather than waiting forever. */
  failed?: boolean;
  /** Lines matched, and why some of them are not in `estimate`. Quests only. */
  matched?: number;
  skipped?: Partial<Record<BatchSkip, number>>;
};

type Props = {
  /** The batch awaiting confirmation, or null when nothing is pending. */
  pending: PendingBatch | null;
  status: GenerationStatusResponse | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The only thing standing between one click and a large share of a month's budget.
 *
 * A single line goes straight through - it is one click, it is cheap, and history makes it
 * reversible. A quest or an NPC can be a hundred lines, so it stops here and says what that
 * will cost against what is left.
 */
export default function RegenerateDialog({ pending, status, onConfirm, onCancel }: Props) {
  if (!pending) return null;
  if (!pending.estimate) {
    return <Waiting label={pending.label} failed={!!pending.failed} onCancel={onCancel} />;
  }

  const { estimate, label } = pending;
  const pinned = pending.pinnedEstimate ?? null;
  const local = status?.provider === "voicestudio";
  const total = (count: "lines" | "files" | "characters") => estimate[count] + (pinned?.[count] ?? 0);
  const skips = SKIP_REASONS.flatMap(([why, text]) => {
    const count = pending.skipped?.[why] ?? 0;
    return count > 0 ? [{ why, text, count }] : [];
  });
  const skippedTotal = skips.reduce((sum, skip) => sum + skip.count, 0);
  // Dollars for fish.audio, credits for ElevenLabs: the estimate, the balance it is weighed
  // against, and the words around them all follow the rate's unit.
  const dollars = estimate.rate.unit === "usd";
  const subscription = status?.subscription ?? null;
  const remaining = dollars
    ? (status?.wallet?.credit ?? null)
    : subscription
      ? subscription.characterLimit - subscription.characterCount
      : null;
  const cost = local ? null : dollars ? estimate.usd : estimate.credits;
  const overBudget = remaining !== null && cost !== null && cost > remaining;
  const amount = (value: number) => (dollars ? usd(value) : `${n(value)} credits`);

  // Zero samples means nothing has been generated with this model yet, so the estimate is
  // using the list rate - an upper bound rather than a measurement. Saying so matters,
  // because the real figure is typically about half of it.
  const uncalibrated = estimate.rate.samples === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate {label}?</DialogTitle>
          <DialogDescription>
            This replaces audio that already exists. Every take is kept, so it can be undone
            line by line.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Lines</dt>
          <dd className="text-right font-mono">{n(total("lines"))}</dd>

          <dt className="text-muted-foreground">Audio files</dt>
          <dd className="text-right font-mono">{n(total("files"))}</dd>

          <dt className="text-muted-foreground">Characters</dt>
          <dd className="text-right font-mono">{n(total("characters"))}</dd>

          <dt className="text-muted-foreground">Estimated cost</dt>
          <dd className="text-right font-mono">
            {cost === null
              ? "unknown"
              : uncalibrated
                ? `up to ${amount(cost)}`
                : `~${amount(cost)}`}
          </dd>

          {pinned && (
            <>
              <dt className="text-muted-foreground">
                Pinned to fish.audio, {n(pinned.files)} {pinned.files === 1 ? "file" : "files"}
              </dt>
              <dd className="text-right font-mono">
                {pinned.usd === null
                  ? "unknown"
                  : pinned.rate.samples === 0
                    ? `up to ${usd(pinned.usd)}`
                    : `~${usd(pinned.usd)}`}
              </dd>
            </>
          )}

          {remaining !== null && (
            <>
              <dt className="text-muted-foreground">Remaining</dt>
              <dd
                className={`text-right font-mono ${overBudget ? "text-destructive" : ""}`}
              >
                {amount(remaining)}
              </dd>
            </>
          )}
        </dl>

        {/* Why the button's count and the files differ: lines nothing voices, and files
            spoken by more than one NPC, each generated once. */}
        {skippedTotal > 0 && (
          <div className="text-muted-foreground text-xs">
            <p>
              {n(skippedTotal)}
              {pending.matched !== undefined && ` of ${n(pending.matched)}`} matching{" "}
              {skippedTotal === 1 ? "line" : "lines"} skipped:
            </p>
            <ul className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 pl-3">
              {skips.map(({ why, text, count }) => (
                <li key={why} className="contents">
                  <span className="text-right font-mono">{n(count)}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {local ? (
          <p className="text-muted-foreground text-xs">
            VoiceStudio runs on the site&apos;s configured local service, so Spoken cannot provide
            a provider cost estimate. Each completed take is recorded in history.
          </p>
        ) : dollars ? (
          <p className="text-muted-foreground text-xs">
            {estimate.rate.unknown
              ? `fish.audio publishes no price for ${estimate.rate.modelId ?? "this model"}, so there is nothing to estimate from. The cost of each line is recorded as it runs.`
              : uncalibrated
                ? `Nothing has been generated with ${estimate.rate.modelId ?? "this model"} in this language yet, so this is fish.audio's list price at the widest this script's characters can be — an upper bound.`
                : `Calibrated from the last ${estimate.rate.samples} fish.audio ${estimate.rate.samples === 1 ? "take" : "takes"} in this language. The cost of each line is recorded as it runs.`}
          </p>
        ) : uncalibrated ? (
          <p className="text-muted-foreground text-xs">
            Nothing has been generated with {estimate.rate.modelId ?? "this model"} yet, so
            this is the list rate — an upper bound. ElevenLabs bills a rate set by your plan,
            and the exact figure is reported after each line.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Calibrated from the last {estimate.rate.samples}{" "}
            {estimate.rate.samples === 1 ? "take" : "takes"} on this account at{" "}
            {estimate.rate.rate.toFixed(3)} credits per character. The exact cost is reported
            as it runs.
          </p>
        )}

        {overBudget && (
          <p role="alert" className="text-destructive text-xs">
            This is more than {dollars ? "the fish.audio balance holds" : "the plan has left"}.
            It will run until {dollars ? "the balance runs out" : "the credits are gone"} and
            then stop, keeping whatever it finished.
          </p>
        )}

        {!dollars && subscription?.resetAt && (
          <p className="text-muted-foreground text-xs">
            Balance resets {new Date(subscription.resetAt).toLocaleDateString()}.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={total("files") === 0}>
            Regenerate {n(total("files"))} {total("files") === 1 ? "file" : "files"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The dialog between the click and the set arriving, which on the whole corpus is seconds. */
function Waiting({
  label,
  failed,
  onCancel,
}: {
  label: string;
  failed: boolean;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate {label}?</DialogTitle>
          <DialogDescription>
            {failed
              ? "Could not work out what this would regenerate."
              : "Counting what this would regenerate…"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {failed ? "Close" : "Cancel"}
          </Button>
          <Button size="sm" disabled>
            Regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
