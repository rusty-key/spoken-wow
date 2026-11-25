"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useLang } from "@/components/LangProvider";
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
import { withLang, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";

/**
 * Clone one voice's clips into the caller's own ElevenLabs account. Null on success, or why
 * it failed.
 */
export async function cloneVoice(lang: Lang, voice: string, replace: boolean): Promise<string | null> {
  try {
    const response = await fetch(withLang(lang, `/api/voices/${voice}/clone`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace }),
    });
    if (response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? `could not create ${voice} (${response.status})`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type Mode = "missing" | "all";

type Run = { mode: Mode; done: string[]; left: string[]; error: string | null; running: boolean };

/**
 * Put this language's roster into the caller's own ElevenLabs account.
 *
 * Asks each time whether to fill only the gaps or to rebuild everything: filling gaps
 * destroys nothing, while rebuilding deletes and re-creates voices that will not sound the
 * same afterwards -- which is also the only way to pick up clips an admin has changed since.
 *
 * Sequential, and it stops at the first failure rather than pressing on. A voice that fails
 * upstream nearly always fails for a reason every later one shares -- the plan's voice cap,
 * a plan without instant cloning, a key revoked -- and fifty identical errors say less than
 * one. What is left is listed, and "Missing only" picks up from there.
 */
export default function PopulateDialog({
  open,
  onClose,
  cloneable,
  present,
  slotsUsed,
  slotLimit,
  onCloned,
}: {
  open: boolean;
  onClose: () => void;
  /** Voices with clips in this language, which are the only ones that can be cloned. */
  cloneable: string[];
  /** Voices already in the account. */
  present: Set<string>;
  /** The account's custom voice slots, or null when the account could not be read. */
  slotsUsed: number | null;
  slotLimit: number | null;
  onCloned: (voice: string) => void;
}) {
  const lang = useLang();
  const t = useUiText();
  const words = t.voices;
  const [run, setRun] = useState<Run | null>(null);

  const missing = cloneable.filter((voice) => !present.has(voice));
  // Replacing deletes before it adds, so only the voices not there yet take a new slot.
  const free = slotsUsed === null || slotLimit === null ? null : Math.max(0, slotLimit - slotsUsed);
  const short = free !== null && missing.length > free ? missing.length - free : 0;

  async function start(mode: Mode) {
    const targets = mode === "missing" ? missing : cloneable;
    let current: Run = { mode, done: [], left: targets, error: null, running: true };
    setRun(current);
    for (const voice of targets) {
      const error = await cloneVoice(lang, voice, mode === "all");
      if (error) {
        current = { ...current, error: `${voice}: ${error}`, running: false };
        setRun(current);
        return;
      }
      onCloned(voice);
      current = { ...current, done: [...current.done, voice], left: current.left.slice(1) };
      setRun(current);
    }
    setRun({ ...current, running: false });
  }

  const running = run?.running ?? false;

  // Not closable mid-run: the loop would carry on with nothing on screen saying so.
  function close(next: boolean) {
    if (next || running) return;
    setRun(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{words.populateTitle}</DialogTitle>
          <DialogDescription>
            {words.populateLede}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p className="tabular-nums">
            {fill(words.populateCount, {
              here: cloneable.length - missing.length,
              all: cloneable.length,
              missing: missing.length,
            })}
          </p>
          {free !== null && (
            <p className="text-muted-foreground tabular-nums">
              {fill(words.slotsLine, { used: String(slotsUsed), limit: String(slotLimit), free })}
            </p>
          )}
          {short > 0 && (
            <p className="text-amber-400">
              {fill(words.planRoom, { free: String(free), short })}
            </p>
          )}

          {run && (
            <div className="bg-muted/40 rounded-md border px-3 py-2 text-xs">
              <p className="tabular-nums">
                {running && <Loader2 className="mr-1 inline size-3 animate-spin" />}
                {fill(words.doneCount, { n: run.done.length })}
                {run.left.length > 0 && fill(words.leftCount, { n: run.left.length })}
              </p>
              {run.error && (
                <p role="alert" className="text-destructive mt-1">
                  {fill(words.stoppedAt, { error: run.error })}
                </p>
              )}
              {!running && run.left.length > 0 && (
                <p className="text-muted-foreground mt-1">{fill(words.notDone, { list: run.left.join(", ") })}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={running || cloneable.length === 0}
            title={words.populateRebuild}
            onClick={() => start("all")}
          >
            {fill(words.replaceAll, { n: cloneable.length })}
          </Button>
          <Button disabled={running || missing.length === 0} onClick={() => start("missing")}>
            {running && run?.mode === "missing" && <Loader2 className="animate-spin" />}
            {fill(words.missingOnly, { n: missing.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
