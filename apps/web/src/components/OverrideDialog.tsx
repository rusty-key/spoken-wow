"use client";

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
import { OverrideError, validateOverride } from "@/lib/quests/override";
import { hasInvalidChars, INVALID_CHARS } from "@/lib/text-gate";
import type { ResultLine } from "@/lib/search";

type Props = {
  /** The line being rewritten, or null when the dialog is closed. */
  line: ResultLine | null;
  onSaved: (file: string, text: string | null) => void;
  onCancel: () => void;
};

/**
 * Rewriting what a line says out loud.
 *
 * A dialog rather than an in-place form, unlike the lexicon editor's rows: this table is
 * `table-fixed` with an explicit colgroup, so a form opened inside a cell inherits a column
 * width it needs to escape - the problem LexiconEditor documents from the other side.
 *
 * The corpus text is shown beside the draft rather than replaced by it, because the useful
 * question while editing is "what did it say before", and because the corpus text is the thing
 * this can always be reverted to.
 */
export default function OverrideDialog({ line, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which line the draft belongs to, so opening a different row reseeds it. Cheaper and less
  // fragile than an effect keyed on the line, which would fight the user's own typing.
  const [seeded, setSeeded] = useState<string | null>(null);

  if (!line) return null;

  if (seeded !== line.key) {
    setSeeded(line.key);
    setDraft(line.override ?? line.text);
    setError(null);
    return null;
  }

  const dirty = draft !== (line.override ?? line.text);
  // Whether this rewrite is what makes the line voiceable, asked of its live state rather
  // than the corpus's baked flag - otherwise a narrated line, which is already voiceable,
  // would claim every edit rescued it.
  const rescues = !line.voiceable && !hasInvalidChars(draft);

  async function send(method: "PUT" | "DELETE") {
    if (!line) return;
    setBusy(true);
    setError(null);

    try {
      if (method === "PUT") {
        // Checked here so the message lands next to the field, and again on the server
        // because that is the copy that counts.
        validateOverride({ file: line.audioPath, lineId: line.lineId, text: draft });
      }

      const url =
        method === "PUT"
          ? "/api/quests/lines/override"
          : `/api/quests/lines/override?file=${encodeURIComponent(line.audioPath)}`;
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body:
          method === "PUT"
            ? JSON.stringify({ file: line.audioPath, lineId: line.lineId, text: draft })
            : undefined,
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      onSaved(line.audioPath, method === "PUT" ? draft.trim() : null);
    } catch (problem) {
      setError(problem instanceof OverrideError ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What should this line say?</DialogTitle>
          <DialogDescription>
            This changes what is spoken, nothing else. The file keeps its name and the addon
            still finds it, because both come from the original text — so existing audio is
            not orphaned, only out of date until it is regenerated.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <label htmlFor="override-text" className="text-muted-foreground text-xs">
            Spoken text · {line.npcName} · {line.audioPath}
          </label>
          <textarea
            id="override-text"
            autoFocus
            rows={6}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="border-input bg-transparent focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
          />
        </div>

        {line.override && (
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs">The corpus says</span>
            <p className="text-muted-foreground bg-muted/40 max-h-24 overflow-y-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap">
              {line.text}
            </p>
          </div>
        )}

        {rescues && (
          <p className="text-xs text-emerald-400">
            This line is not voiced today because its text holds one of {INVALID_CHARS}. Saving
            this makes it generatable.
          </p>
        )}

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={busy || !line.override}
            onClick={() => void send("DELETE")}
            title={line.override ? "Go back to what the corpus says" : "There is nothing to revert"}
          >
            Revert to original
          </Button>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || !dirty} onClick={() => void send("PUT")}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
