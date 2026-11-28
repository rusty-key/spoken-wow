"use client";

import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fill } from "@/lib/site-text/format";

export type BulkKeepRow = { id: number; count: number };

const CONFIDENT_DEFAULT = 10;

/** Every group counts, Probably drop included: enough players sending the same words outweighs the checks. */
export function confidentIds(rows: BulkKeepRow[], moreThan: number): number[] {
  return rows.filter((row) => row.count > moreThan).map((row) => row.id);
}

/**
 * Null until the box holds a whole number of at least 1. Read as 0, a box emptied to retype it
 * would select every line in the queue, Probably drop included, one click from keeping them all.
 */
export function parseThreshold(typed: string): number | null {
  return /^\s*[1-9]\d*\s*$/.test(typed) ? Number(typed) : null;
}

/** Says how many lines Keep confident takes before it runs, since a kept line can't be reopened. */
export default function BulkKeepDialog({
  rows,
  everyPage,
  onConfirm,
  onClose,
}: {
  /** Rows still undecided that a bulk accept may take, on every page. */
  rows: BulkKeepRow[];
  everyPage: boolean;
  onConfirm: (ids: number[]) => void;
  onClose: () => void;
}) {
  const text = useUiText().contributions;
  const t = text.bulkKeep;
  const [typed, setTyped] = useState(String(CONFIDENT_DEFAULT));
  const moreThan = parseThreshold(typed);
  const ids = moreThan === null ? [] : confidentIds(rows, moreThan);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.confidentTitle}</DialogTitle>
          <DialogDescription>{t.confidentBody}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          {t.sentByMoreThan}
          <Input
            type="number"
            min={1}
            step={1}
            className="w-20"
            value={typed}
            aria-invalid={moreThan === null}
            onChange={(event) => setTyped(event.target.value)}
          />
          {t.players}
        </label>
        <p className="text-sm">
          {fill(everyPage ? t.willKeepEvery : t.willKeep, { n: ids.length })} {t.final}
        </p>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {text.cancel}
          </Button>
          <Button size="sm" disabled={ids.length === 0} onClick={() => onConfirm(ids)}>
            {fill(t.keep, { n: ids.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
