"use client";

import { useLang } from "@/components/LangProvider";
import { useUiText } from "@/components/UiTextProvider";
import { BASE_LANG, withLang } from "@/lib/lang";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ResultLine } from "@/lib/search";
import { fill } from "@/lib/site-text/format";

type Props = {
  /** The line being ignored, or null when the dialog is closed. */
  line: ResultLine | null;
  onSaved: (lineId: string, reason: string | null) => void;
  onCancel: () => void;
};

/**
 * Deciding that a line will never be voiced.
 *
 * A dialog for the reason a rewrite gets one - the table is `table-fixed`, so a form opened
 * in a cell inherits a column width - but a much smaller one: the only field is why.
 *
 * The reason is required and there is no default text to accept, because this list is read
 * months later by someone deciding whether the entry still holds. An entry saying nothing
 * cannot be reviewed, only inherited.
 */
export default function IgnoreDialog({ line, onSaved, onCancel }: Props) {
  const words = useUiText().catalogue.dialogs;
  const t = words.ignore;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which line the draft belongs to, so opening a different row reseeds it. Same reasoning
  // as OverrideDialog: an effect keyed on the line would fight the user's own typing.
  const [seeded, setSeeded] = useState<string | null>(null);

  const lang = useLang();
  if (!line) return null;

  if (seeded !== line.key) {
    setSeeded(line.key);
    setReason(line.ignored ?? "");
    setError(null);
    return null;
  }

  async function send(method: "PUT" | "DELETE") {
    if (!line) return;
    setBusy(true);
    setError(null);

    try {
      const base =
        method === "PUT"
          ? "/api/quests/lines/ignore"
          : `/api/quests/lines/ignore?lineId=${encodeURIComponent(line.lineId)}`;
      // On the English site an ignore means what it always has, every language; on another
      // language's, it is that language's own decision.
      const url =
        lang === BASE_LANG
          ? `${base}${base.includes("?") ? "&" : "?"}scope=all`
          : withLang(lang, base);
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ lineId: line.lineId, reason }) : undefined,
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      onSaved(line.lineId, method === "PUT" ? reason.trim() : null);
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.body}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <span className="text-muted-foreground text-xs">
            {line.npcName} · {line.lineId}
          </span>
          <p className="text-muted-foreground bg-muted/40 max-h-24 overflow-y-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap">
            {line.override ?? line.text}
          </p>
          <label htmlFor="ignore-reason" className="text-muted-foreground text-xs">
            {t.reason}
          </label>
          <input
            id="ignore-reason"
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            placeholder={t.reasonPlaceholder}
            className="border-input bg-transparent focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {/* Only offered on a line that is already ignored, so an untouched line has one
              action rather than two. */}
          {line.ignored ? (
            <Button variant="ghost" disabled={busy} onClick={() => send("DELETE")}>
              {t.stopIgnoring}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              {words.cancel}
            </Button>
            <Button disabled={busy || !reason.trim()} onClick={() => send("PUT")}>
              {line.ignored ? t.saveReason : t.ignoreThis}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
