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
import { useUiText } from "@/components/UiTextProvider";
import type { Estimate } from "@/lib/generation/billing";
import type { BatchSkip, GenerationStatusResponse } from "@/lib/generation/client";
import { usd } from "@/lib/generation/money";
import { fill } from "@/lib/site-text/format";

function n(value: number): string {
  return value.toLocaleString();
}

const SKIP_REASONS: BatchSkip[] = ["no-voice", "untranslated", "invalid-chars", "shared-file"];

const SKIP_WORDS = {
  "no-voice": "noVoice",
  untranslated: "untranslated",
  "invalid-chars": "invalidChars",
  "shared-file": "sharedFile",
} as const;

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
  const t = useUiText().catalogue.dialogs.regenerate;
  if (!pending) return null;
  if (!pending.estimate) {
    return <Waiting label={pending.label} failed={!!pending.failed} onCancel={onCancel} />;
  }

  const { estimate, label } = pending;
  const pinned = pending.pinnedEstimate ?? null;
  const total = (count: "lines" | "files" | "characters") => estimate[count] + (pinned?.[count] ?? 0);
  const skips = SKIP_REASONS.flatMap((why) => {
    const count = pending.skipped?.[why] ?? 0;
    return count > 0 ? [{ why, text: t.reasons[SKIP_WORDS[why]], count }] : [];
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
  const cost = dollars ? estimate.usd : estimate.credits;
  const overBudget = remaining !== null && cost !== null && cost > remaining;
  const amount = (value: number) => (dollars ? usd(value) : fill(t.credits, { n: n(value) }));

  // Zero samples means nothing has been generated with this model yet, so the estimate is
  // using the list rate - an upper bound rather than a measurement. Saying so matters,
  // because the real figure is typically about half of it.
  const uncalibrated = estimate.rate.samples === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fill(t.title, { what: label })}</DialogTitle>
          <DialogDescription>{t.body}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">{t.lines}</dt>
          <dd className="text-right font-mono">{n(total("lines"))}</dd>

          <dt className="text-muted-foreground">{t.files}</dt>
          <dd className="text-right font-mono">{n(total("files"))}</dd>

          <dt className="text-muted-foreground">{t.characters}</dt>
          <dd className="text-right font-mono">{n(total("characters"))}</dd>

          <dt className="text-muted-foreground">{t.estimatedCost}</dt>
          <dd className="text-right font-mono">
            {cost === null
              ? t.unknown
              : uncalibrated
                ? fill(t.upTo, { amount: amount(cost) })
                : fill(t.about, { amount: amount(cost) })}
          </dd>

          {pinned && (
            <>
              <dt className="text-muted-foreground">
                {fill(t.pinned, { n: n(pinned.files), what: pinned.files === 1 ? t.fileOne : t.fileMany })}
              </dt>
              <dd className="text-right font-mono">
                {pinned.usd === null
                  ? t.unknown
                  : pinned.rate.samples === 0
                    ? fill(t.upTo, { amount: usd(pinned.usd) })
                    : fill(t.about, { amount: usd(pinned.usd) })}
              </dd>
            </>
          )}

          {remaining !== null && (
            <>
              <dt className="text-muted-foreground">{t.remaining}</dt>
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
              {fill(
                pending.matched !== undefined ? t.skipped : t.skippedAll,
                {
                  n: n(skippedTotal),
                  all: pending.matched !== undefined ? n(pending.matched) : "",
                  what: skippedTotal === 1 ? t.lineOne : t.lineMany,
                },
              )}
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

        {dollars ? (
          <p className="text-muted-foreground text-xs">
            {estimate.rate.unknown
              ? fill(t.unknownPrice, { model: estimate.rate.modelId ?? t.thisModel })
              : uncalibrated
                ? fill(t.fishListPrice, { model: estimate.rate.modelId ?? t.thisModel })
                : fill(t.fishCalibrated, {
                    n: estimate.rate.samples,
                    takes: estimate.rate.samples === 1 ? t.takeOne : t.takeMany,
                  })}
          </p>
        ) : uncalibrated ? (
          <p className="text-muted-foreground text-xs">
            {fill(t.creditsListPrice, { model: estimate.rate.modelId ?? t.thisModel })}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {fill(t.creditsCalibrated, {
              n: estimate.rate.samples,
              takes: estimate.rate.samples === 1 ? t.takeOne : t.takeMany,
              rate: estimate.rate.rate.toFixed(3),
            })}
          </p>
        )}

        {overBudget && (
          <p role="alert" className="text-destructive text-xs">
            {dollars ? t.overBudgetFish : t.overBudgetCredits}
          </p>
        )}

        {!dollars && subscription?.resetAt && (
          <p className="text-muted-foreground text-xs">
            {fill(t.resets, { date: new Date(subscription.resetAt).toLocaleDateString() })}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={total("files") === 0}>
            {fill(t.submit, { n: n(total("files")), what: total("files") === 1 ? t.fileOne : t.fileMany })}
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
  const t = useUiText().catalogue.dialogs.regenerate;
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fill(t.title, { what: label })}</DialogTitle>
          <DialogDescription>{failed ? t.waitingFailed : t.waiting}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {failed ? t.close : t.cancel}
          </Button>
          <Button size="sm" disabled>
            {t.submitShort}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
