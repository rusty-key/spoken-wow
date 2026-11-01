"use client";

/**
 * The line a report is about, shown beside it.
 *
 * A triager's loop used to be: read the row, open the explorer in another tab, find the
 * line, listen, come back. The context that picked the voice, the text as it will be
 * spoken and the button that cuts a new take are here; the audio plays through the page's
 * transport bar, the same one both explorers use, so one line stops the previous one.
 *
 * Presentational: the row is fetched by ReportTable, which owns the transport bar the play
 * button starts.
 */
import { useLang } from "@/components/LangProvider";
import { Play } from "lucide-react";
import { useState } from "react";

import OverrideDialog from "@/components/OverrideDialog";
import OutdatedNote from "@/components/OutdatedNote";
import LineHeading from "@/components/reports/LineHeading";
import { Button } from "@/components/ui/button";
import { detailOf, regenerateLine, type SourceLine } from "@/lib/reports/detail";

import type { ResultLine as QuestLine } from "@/lib/search";
import type { Source } from "@/lib/sections";

type Props = {
  source: Source;
  lineId: string;
  /** The line, or null once the lookup came back with none. Undefined while it is in flight. */
  line: SourceLine | null | undefined;
  /** Whether this visitor may spend credits. The page already gates the rest. */
  canRegenerate: boolean;
  /** Whether the speaker's name opens the NPC page. See LineHeading. */
  showNpcPage: boolean;
  /** Hands the new take's version up, so the player busts its cache. */
  onRegenerated: (version: number) => void;
  /** A rewrite was saved, so the panel and the row read the text that will be spoken next. */
  onRewritten: () => void;
  /** Points the page's transport bar at this line and starts it. */
  onPlay: () => void;
};

export default function ReportDetail({
  source,
  lineId,
  line,
  canRegenerate,
  showNpcPage,
  onRegenerated,
  onRewritten,
  onPlay,
}: Props) {
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setError(null);
    setDone(false);

    const result = await regenerateLine(source, lineId, lang);
    setBusy(false);
    if ("error" in result) return setError(result.error);

    setDone(true);
    onRegenerated(result.version);
  }

  if (line === undefined) {
    return <p className="text-muted-foreground px-3 py-3 text-sm">Looking up the line…</p>;
  }

  // An address that resolves to nothing is itself worth reading: it means the corpus no
  // longer carries the line the report is about, which is information about the data
  // module rather than an error on this page.
  if (line === null) {
    return (
      <p className="text-muted-foreground px-3 py-3 text-sm">
        No line in the corpus carries this id any more.
      </p>
    );
  }

  const detail = detailOf(source, line, undefined, lang);

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-center gap-1">
        {detail.audioSrc === null ? null : (
          <Button size="icon-xs" variant="ghost" title="Play this line" aria-label="Play this line" onClick={onPlay}>
            <Play />
          </Button>
        )}
        <div>
          <LineHeading detail={detail} showNpcPage={showNpcPage} asideClassName="ml-2" />
        </div>
      </div>

      {detail.text === null ? (
        <p className="text-muted-foreground text-sm italic">No story in this language yet.</p>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{detail.text}</p>
      )}

      {detail.audioSrc === null ? (
        <p className="text-muted-foreground text-xs">No audio on file for this line.</p>
      ) : detail.stale ? (
        <OutdatedNote className="text-xs" />
      ) : null}

      {canRegenerate ? (
        <div className="flex items-center gap-3">
          {/* Nothing written in the language is nothing to voice: the server would refuse it. */}
          {detail.text === null ? null : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void regenerate()}>
              {busy ? "Regenerating…" : "Regenerate"}
            </Button>
          )}
          {/* Quests only: the override endpoint is theirs, and places and readables have no text a
              triager may edit - their lines are the corpus itself. */}
          {source === "quests" && !(line as QuestLine).missing?.text ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              Rewrite
            </Button>
          ) : null}
          {done && !busy ? (
            <span className="text-muted-foreground text-xs">New take saved. Play it above.</span>
          ) : null}
          {error ? <span className="text-destructive text-xs">{error}</span> : null}
        </div>
      ) : null}

      {/* "Wrong words" and "wrong voice" are the two complaints this panel answers, so the
          fix for the first is a press away from the fix for the second: rewrite, then
          regenerate, without leaving the triage list. */}
      {editing && source === "quests" ? (
        <OverrideDialog
          line={line as QuestLine}
          onSaved={() => {
            setEditing(false);
            onRewritten();
          }}
          // The moment's other lines took the text too, so the explorer is where to see them.
          onRewritten={() => {
            setEditing(false);
            onRewritten();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
