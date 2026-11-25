"use client";

import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dropTextOverride, saveTextOverride } from "@/lib/text-overrides/client";
import type { NarratedSource } from "@/lib/text-overrides/types";

type Props = {
  source: NarratedSource;
  /** The line being overridden, or null when the dialog is closed. */
  line: { lineId: string; original: string; override: string | null } | null;
  /** The saved text, or null once the override is removed. */
  onSaved: (lineId: string, text: string | null) => void;
  onCancel: () => void;
};

/**
 * What the acting team's voice says for a place, readable or boss line, in place of its text.
 *
 * The original stays beside the draft because it is what everyone else still reads and what
 * a removal goes back to.
 */
export default function TextOverrideDialog({ source, line, onSaved, onCancel }: Props) {
  const lang = useLang();
  const words = useUiText();
  const t = words.catalogue.dialogs.teamOverride;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed by line, not reseeded in an effect, so a refresh of the same line keeps the draft.
  const [seeded, setSeeded] = useState<string | null>(null);

  if (!line) return null;

  if (seeded !== line.lineId) {
    setSeeded(line.lineId);
    setDraft(line.override ?? line.original);
    setError(null);
    return null;
  }

  const trimmed = draft.trim();
  const dirty = trimmed !== "" && trimmed !== (line.override ?? line.original).trim();
  // An override saying the original would be a copy that drifts the moment the original
  // changes, so going back to the original's words removes the override instead.
  const backToOriginal = line.override !== null && trimmed === line.original.trim();

  function cancel() {
    setSeeded(null);
    setError(null);
    onCancel();
  }

  async function send(method: "PUT" | "DELETE") {
    if (!line) return;
    setBusy(true);
    setError(null);
    try {
      const response = await (method === "PUT"
        ? saveTextOverride(lang, source, line.lineId, draft)
        : dropTextOverride(lang, source, line.lineId));
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      setSeeded(null);
      onSaved(line.lineId, method === "PUT" ? draft.trim() : null);
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && cancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.body}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <label htmlFor="text-override" className="text-muted-foreground text-xs">
            {t.ours}
          </label>
          <textarea
            id="text-override"
            aria-describedby="text-override-original"
            autoFocus
            rows={6}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="border-input bg-transparent focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
          />
        </div>

        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs">{t.original}</span>
          <p
            id="text-override-original"
            className="text-muted-foreground bg-muted/40 max-h-24 overflow-y-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap"
          >
            {line.original}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {line.override !== null ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void send("DELETE")}
              title={t.removeTitle}
            >
              {t.remove}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              {words.common.cancel}
            </Button>
            <Button disabled={busy || !dirty} onClick={() => void send(backToOriginal ? "DELETE" : "PUT")}>
              {busy ? words.catalogue.dialogs.saving : words.catalogue.dialogs.save}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
