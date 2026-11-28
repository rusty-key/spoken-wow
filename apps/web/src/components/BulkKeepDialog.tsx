"use client";

import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Verdict } from "@/lib/contributions/checks";
import { fill } from "@/lib/site-text/format";

export type BulkKeepMode = "confident" | "clean";

export type BulkKeepRow = { id: number; count: number; verdict: Verdict };

export const CONFIDENT_DEFAULT = 10;

/** The rows a bulk keep takes: "confident" is any group, Probably drop included, past the threshold. */
export function bulkKeepIds(rows: BulkKeepRow[], mode: BulkKeepMode, moreThan: number): number[] {
  return rows
    .filter((row) => (mode === "confident" ? row.count > moreThan : row.verdict === "clean"))
    .map((row) => row.id);
}

/** Says how many lines a bulk keep takes before it runs, since a kept line can't be reopened. */
export default function BulkKeepDialog({
  mode,
  rows,
  everyPage,
  onConfirm,
  onClose,
}: {
  mode: BulkKeepMode;
  /** Rows still undecided that a bulk accept may take, on every page. */
  rows: BulkKeepRow[];
  everyPage: boolean;
  onConfirm: (ids: number[]) => void;
  onClose: () => void;
}) {
  const t = useUiText().contributions.bulkKeep;
  const [moreThan, setMoreThan] = useState(CONFIDENT_DEFAULT);
  const ids = bulkKeepIds(rows, mode, moreThan);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "confident" ? t.confidentTitle : t.looksRightTitle}</DialogTitle>
          <DialogDescription>{mode === "confident" ? t.confidentBody : t.looksRightBody}</DialogDescription>
        </DialogHeader>
        {mode === "confident" ? (
          <label className="flex items-center gap-2 text-sm">
            {t.sentByMoreThan}
            <Input
              type="number"
              min={0}
              step={1}
              className="w-20"
              value={moreThan}
              onChange={(event) => setMoreThan(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
            />
            {t.players}
          </label>
        ) : null}
        <p className="text-sm">
          {fill(everyPage ? t.willKeepEvery : t.willKeep, { n: ids.length })} {t.final}
        </p>
        <DialogFooter>
          <button type="button" className="bs-btn bs-btn-text" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="bs-btn bs-btn-primary"
            disabled={ids.length === 0}
            onClick={() => onConfirm(ids)}
          >
            {fill(t.keep, { n: ids.length })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
