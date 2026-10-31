"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { useLang } from "@/components/LangProvider";
import { Button } from "@/components/ui/button";
import { useFileDrop } from "@/components/useFileDrop";
import { withLang } from "@/lib/lang";
import { RECORDING_ACCEPT, type Match } from "@/lib/recordings/match";
import { uploadRecording } from "@/lib/recordings/upload";
import type { Source } from "@/lib/sections";
import { cn } from "@/lib/utils";

const REASONS: Record<Exclude<Match, { file: string }>["reason"], string> = {
  format: "not .mp3 or .ogg",
  unmatched: "no line has this name",
  ambiguous: "more than one line has this name",
  duplicate: "another file in this drop names the same line",
};

/** What each section's files are called, for the hint under the zone. */
const NAMING: Record<Source, string> = {
  quests: "the line's file name: 33-accept.ogg, m-33-accept.ogg (male player), or a gossip hash",
  places: "map id and place: 1411-razor-hill.ogg, or 1411-zone.ogg for the zone itself",
  readables: "the page id: 1381.ogg",
  bosses: "map id and boss: 36-edwin-vancleef.ogg",
};

type Matched = Extract<Match, { file: string }>;

type Plan = { matched: Matched[]; refused: Match[]; files: Map<string, File> };

/**
 * How many files are in flight at once. Each is probed and archived on the server before it
 * answers, so a few at a time keeps a session's upload from taking N round trips end to end
 * without asking one request to carry more than one file.
 */
const PARALLEL = 3;

type Progress = { done: number; total: number; failed: { name: string; error: string }[] };

/**
 * A session's worth of recordings at once, matched to lines by name.
 *
 * Two steps, so nothing lands anywhere unexpected: the names go to the server first, and
 * the actor sees which line each file will become and which files will not land at all,
 * before a byte of audio is sent. Then each goes in a request of its own, a few at a time,
 * which is what the route takes and what lets one refused file fail alone. Over the whole language, not the
 * page: a session is recorded from a script, not from whatever the filter shows.
 */
export default function RecordingDropZone({ source, onUploaded }: { source: Source; onUploaded: () => void }) {
  const lang = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null && progress.done < progress.total;

  async function match(dropped: File[]) {
    if (dropped.length === 0) return;
    setError(null);
    setProgress(null);
    const files = new Map(dropped.map((file) => [file.name, file]));
    try {
      const response = await fetch(withLang(lang, "/api/recordings/match"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, names: [...files.keys()] }),
      });
      if (!response.ok) {
        setError(`could not match the files (${response.status})`);
        return;
      }
      const { matches } = (await response.json()) as { matches: Match[] };
      setPlan({
        matched: matches.filter((m): m is Matched => m.file !== null),
        refused: matches.filter((m) => m.file === null),
        files,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function upload(current: Plan) {
    const state: Progress = { done: 0, total: current.matched.length, failed: [] };
    setProgress({ ...state });
    const queue = [...current.matched];
    async function worker() {
      for (let match = queue.shift(); match; match = queue.shift()) {
        const result = await uploadRecording(lang, { source, file: match.file }, current.files.get(match.name)!);
        state.done++;
        if (!result.ok) state.failed.push({ name: match.name, error: result.error });
        setProgress({ ...state, failed: [...state.failed] });
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setPlan(null);
    onUploaded();
  }

  const drop = useFileDrop((files) => {
    if (!uploading) void match(files);
  });

  return (
    <div
      className={cn(
        "rounded-md border border-dashed px-3 py-2 text-sm",
        drop.over ? "border-ring bg-accent/40" : "border-border",
      )}
      {...drop.handlers}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Upload className="text-muted-foreground size-4" />
        <span>Drop a session&apos;s recordings here, or</span>
        <Button variant="outline" size="xs" disabled={uploading} onClick={() => input.current?.click()}>
          choose files
        </Button>
        <span className="text-muted-foreground text-xs">Name each after its line: {NAMING[source]}.</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={RECORDING_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void match([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}

      {plan && !uploading && (
        <div className="mt-2 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {plan.matched.length} of {plan.matched.length + plan.refused.length} files match a line.
            </span>
            <Button size="xs" disabled={plan.matched.length === 0} onClick={() => void upload(plan)}>
              Upload {plan.matched.length}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setPlan(null)}>
              Cancel
            </Button>
          </div>
          {plan.refused.length > 0 && (
            <ul className="text-muted-foreground max-h-40 overflow-y-auto">
              {plan.refused.map((match) => (
                <li key={match.name}>
                  <span className="text-foreground font-mono">{match.name}</span> — {"reason" in match && REASONS[match.reason]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {progress && (
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex items-center gap-2">
            {uploading && <Loader2 className="size-3 animate-spin" />}
            <span>
              {uploading ? "Uploading" : "Uploaded"} {progress.done - progress.failed.length} of {progress.total}
              {progress.failed.length > 0 && `, ${progress.failed.length} refused`}
            </span>
          </div>
          {progress.failed.length > 0 && (
            <ul className="text-destructive max-h-40 overflow-y-auto">
              {progress.failed.map((failure) => (
                <li key={failure.name}>{failure.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
