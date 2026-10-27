"use client";

import { Loader2, Pause, Play, X } from "lucide-react";
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
import { dismissQueue, pauseQueue, resumeQueue, type QueueSnapshot } from "@/lib/generation/client";
import { usd } from "@/lib/generation/money";
import { queueStatus } from "@/lib/generation/queue-line";
import { LOCALES } from "@/lib/lang";

import { Contained } from "./Width";

function n(value: number): string {
  return value.toLocaleString();
}

function languageName(code: string): string {
  return LOCALES.find((locale) => locale.code === code)?.name ?? code;
}

/**
 * What the queue is doing, while it does it.
 *
 * Sits above the player rather than replacing it, because a batch takes minutes and the
 * point of watching is to play the lines as they land.
 *
 * It shows the whole queue, not this tab's work: Stop reaches every batch the viewer may
 * stop, and each person's queue is listed so a waiting batch says why it has not started.
 *
 * The cost shown is the real one, summed from what ElevenLabs charged each line, not the
 * estimate the dialog offered - so an estimate that was wrong is visible rather than quietly
 * preserved.
 *
 * `note` answers the click rather than the batch: it says what the enqueue request itself
 * reported (refused outright, or queued fewer files than quoted because another admin had
 * already claimed some) - information the server snapshot has no field for, since it is
 * about one request rather than the queue's ongoing state.
 *
 * The X means "I am done with this". On a live queue that is a request to stop it, which spends
 * nobody's money but throws away a run someone may be waiting on, so it asks first. On a
 * settled one it closes the panel and dismisses the run on the server, so the next reload does
 * not bring it back.
 *
 * Pause sits beside it for the case Stop is too blunt for: hold the queue without losing its
 * place. It reaches the viewer's own languages, as Stop does, so a pause someone else put on
 * a language the viewer cannot regenerate in is shown but outlives their Resume. The panel does both itself rather than leaving them to each explorer:
 * three copies of the dismissal had drifted into three different bugs.
 */
export default function RegenerationPanel({
  queue,
  note,
  onStop,
  onDismiss,
}: {
  queue: QueueSnapshot | null;
  note: string | null;
  onStop: () => void;
  /** Called when the panel is closed, so the page can drop its own note. */
  onDismiss: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Held while a pause or resume is in flight, so a second click cannot undo the first before
  // the poll has shown what it did.
  const [toggling, setToggling] = useState(false);
  // The run this tab closed, hidden at once rather than on the next poll: at the idle pace
  // that is up to fifteen seconds of an X that seems to do nothing. Keyed by the run's newest
  // job, so anything that settles afterwards shows itself again.
  const [closed, setClosed] = useState<string | null>(null);

  const hidden = !!queue && !queue.active && queue.through !== null && queue.through === closed;
  const counts = hidden ? undefined : queue?.counts;
  const total = counts
    ? counts.pending + counts.running + counts.done + counts.failed + counts.cancelled
    : 0;

  if (total === 0) {
    // Without a batch to show, this is the only way a refused or partly-skipped click gets
    // an answer at all - the alternative is a button that appears to do nothing.
    if (!note) return null;
    return (
      <div className="bg-card/95 border-t backdrop-blur">
        <Contained className="text-muted-foreground py-2.5 text-sm">{note}</Contained>
      </div>
    );
  }

  // `queue` cannot be null here: total > 0 only when counts came from a real snapshot.
  const snapshot = queue!;
  const { pending, running, done, failed, cancelled } = counts!;
  const attempted = done + failed;
  const percent = total ? Math.round((attempted / total) * 100) : 0;
  const active = snapshot.active;
  // The counts above are the whole queue's, deliberately, but "Stopped" and the reason under
  // it describe one batch. Read globally they would hang the last stop's obituary on the next
  // batch to run cleanly, for as long as the stopped one stayed in the window.
  const stopped = !active && (snapshot.latestBatch?.cancelled ?? 0) > 0;
  // A server from before per-owner queues sends no `queues`, and a tab can poll one for the
  // seconds of a pm2 reload or for as long as a rollback lasts. No list beats a crashed panel.
  const queues = snapshot.queues ?? [];
  // Optional for the same reason as `queues`.
  const pauses = snapshot.paused ?? [];
  // Paused rather than regenerating once the pause has taken hold: nothing left in flight.
  // Until then the jobs it let finish are still running, and the spinner says so.
  const paused = active && pauses.length > 0 && running === 0;

  return (
    <div className="bg-card/95 border-t backdrop-blur">
      <Contained className="py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {active && !paused && <Loader2 className="size-4 shrink-0 animate-spin" />}

          <span className="font-medium">
            {paused ? "Paused" : active ? "Regenerating" : stopped ? "Stopped" : "Finished"}
          </span>

          <span className="text-muted-foreground font-mono text-xs">
            {n(attempted)}/{n(total)}
            {/* The number in flight is the visible proof this is no longer sequential. */}
            {running > 0 && <span> · {n(running)} at once</span>}
            {failed > 0 && <span className="text-destructive"> · {n(failed)} failed</span>}
            {cancelled > 0 && <span> · {n(cancelled)} cancelled</span>}
          </span>

          <span className="text-muted-foreground ml-auto font-mono text-xs">
            {/* Unpriced takes are counted separately rather than folded in as zero, which
                would understate the total and look like a bargain. */}
            {/* Each provider in its own unit, side by side and never summed: a total that
                added dollars to credits would be wrong without looking wrong. */}
            {(snapshot.credits > 0 || snapshot.costUsd === 0) && `${n(snapshot.credits)} credits`}
            {snapshot.credits > 0 && snapshot.costUsd > 0 && " · "}
            {snapshot.costUsd > 0 && usd(snapshot.costUsd)}
            {snapshot.unpriced > 0 && ` · ${n(snapshot.unpriced)} unpriced`}
          </span>

          {(active || pauses.length > 0) && (
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={toggling}
              aria-label={pauses.length > 0 ? "Resume the queue" : "Pause the queue"}
              title={pauses.length > 0 ? "Resume" : "Pause, keeping what is waiting"}
              onClick={() => {
                setToggling(true);
                void (pauses.length > 0 ? resumeQueue() : pauseQueue()).finally(() =>
                  setToggling(false),
                );
              }}
            >
              {pauses.length > 0 ? <Play /> : <Pause />}
            </Button>
          )}

          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={active ? "Stop the queue" : "Dismiss"}
            onClick={() => {
              if (active) {
                setConfirming(true);
                return;
              }
              setClosed(snapshot.through);
              onDismiss();
              if (snapshot.through) void dismissQueue(snapshot.through);
            }}
          >
            <X />
          </Button>
        </div>

        <div className="bg-muted mt-2 h-1 overflow-hidden rounded-full">
          <div
            className="bg-primary-ink h-full transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        {note && <div className="text-muted-foreground mt-1.5 text-xs">{note}</div>}

        {pauses.length > 0 && (
          <div className="text-muted-foreground mt-1.5 text-xs">
            Paused:{" "}
            {pauses
              .map((pause) => `${languageName(pause.lang)}${pause.by ? ` by ${pause.by}` : ""}`)
              .join(" · ")}
          </div>
        )}

        {snapshot.running.length > 0 && active && (
          <div className="text-muted-foreground mt-1.5 truncate text-xs">
            {snapshot.running.map((job) => `${job.npcName} — ${job.preview}`).join(" · ")}
          </div>
        )}

        {/* One row per person's queue once there is more than one: who is running, who is
            waiting and behind how many. The viewer's own is picked out. */}
        {active && queues.length > 1 && (
          <ul className="text-muted-foreground mt-1.5 space-y-0.5 text-xs">
            {queues.map((queue) => (
              <li
                key={queue.owner ?? "deleted"}
                className={queue.mine ? "text-foreground font-medium" : undefined}
              >
                {queue.name} — {queueStatus(queue)}
              </li>
            ))}
          </ul>
        )}

        {stopped && snapshot.latestBatch?.stoppedBecause && (
          <div role="alert" className="text-destructive mt-1.5 text-xs">
            {snapshot.latestBatch.stoppedBecause}
          </div>
        )}

        {/* Failures are listed rather than counted: "3 failed" tells you nothing you can act
            on, and the upstream text usually tells you exactly what to fix. */}
        {snapshot.failures.length > 0 && !active && (
          <ul className="text-muted-foreground mt-1.5 max-h-24 space-y-0.5 overflow-y-auto text-xs">
            {snapshot.failures.map((job) => (
              <li key={job.lineId} className="truncate">
                <span className="font-mono">{job.lineId}</span> — {job.message}
              </li>
            ))}
          </ul>
        )}
      </Contained>

      {/* Held open only while there is still something to stop: a queue that drains while the
          question is up has nothing left to cancel, and the X then closes it as usual. */}
      <Dialog open={confirming && active} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Stop the queue?</DialogTitle>
            <DialogDescription>
              {/* No count: Stop reaches only the languages the caller regenerates in, so
                  the queue's pending total can be more than this cancels. */}
              Lines still waiting are cancelled. Any already generating will finish, since
              they are billed either way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep going
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onStop();
              }}
            >
              Stop queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
