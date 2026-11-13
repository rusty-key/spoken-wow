"use client";

import { ChevronDown, Loader2, Pause, Play, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLang } from "@/components/LangProvider";
import { when } from "@/components/TakeSelector";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFileDrop } from "@/components/useFileDrop";
import { useRecordingPreview } from "@/components/useRecordingPreview";
import { useSession } from "@/lib/auth-client";
import { withLang } from "@/lib/lang";
import type { LiveRecording } from "@/lib/recordings/live";
import { RECORDING_ACCEPT, recordingStem } from "@/lib/recordings/match";
import { recordingAudioUrl, uploadRecording } from "@/lib/recordings/upload";
// Type-only, so the store's server-only guard never reaches the bundle.
import type { Recording } from "@/lib/recordings/store";
import type { Source } from "@/lib/sections";
import { cn } from "@/lib/utils";

/**
 * The voice actor column: the file's live recording, a way to hear it and every earlier one,
 * and a way to put a new one in.
 *
 * Beside the Audio column and never inside it, because a recording is not a take: it does
 * not replace the generated audio, it ships in a pack of its own (migration 0062). So this
 * cell has its own number, its own history and its own player.
 *
 * The whole cell takes a dropped file, as well as the button, because an actor working down
 * a page has the file in a Finder window and the row in front of them. A newer upload is
 * live at once -- anybody's, since "latest ships" is the rule -- and removing it brings back
 * the one before. Only its author or an admin may remove one; anybody recording here may
 * hear them all.
 */
export default function ActorTakeCell({
  source,
  file,
  recording,
  onChanged,
}: {
  source: Source;
  file: string;
  recording: LiveRecording | null;
  /** Something was uploaded or removed: the row's live recording has moved. */
  onChanged: () => void;
}) {
  const lang = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (audio: File | undefined) => {
      if (!audio) return;
      setBusy(true);
      setError(null);
      const result = await uploadRecording(lang, { source, file }, audio);
      setBusy(false);
      if (result.ok) onChanged();
      else setError(result.error);
    },
    [lang, source, file, onChanged],
  );

  // One file per line: a second one would only be the next version a moment later.
  const drop = useFileDrop((files) => void send(files[0]));
  const stem = recordingStem(source, file);

  return (
    <td
      className={cn("px-2 py-2 text-xs", drop.over && "bg-accent/40 outline-ring outline-1 -outline-offset-1")}
      {...drop.handlers}
    >
      <div className="flex items-center gap-1">
        {recording ? (
          <>
            <PlayButton
              url={recordingAudioUrl(lang, source, file, recording.version)}
              title={`Play ${recording.credit}'s recording`}
              label={`Play the voice actor's recording of ${stem}`}
              onFailed={setError}
            />
            <RecordingHistory source={source} file={file} live={recording} onChanged={onChanged} />
          </>
        ) : (
          <span className="text-muted-foreground/60">none</span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          title={`Upload a recording (mp3 or Ogg Vorbis), or drop one here. Name it ${stem}.ogg for the bulk drop.`}
          aria-label={`Upload a recording of ${stem}`}
          onClick={() => input.current?.click()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        </Button>
        <input
          ref={input}
          type="file"
          accept={RECORDING_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void send(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {recording && (
        <div className="text-muted-foreground truncate" title={recording.credit}>
          {recording.credit}
        </div>
      )}
      {error && (
        <div role="alert" className="text-destructive max-w-48 whitespace-normal">
          {error}
        </div>
      )}
    </td>
  );
}

/** Play or stop one recording through the page's one preview player. */
function PlayButton({
  url,
  title,
  label,
  onFailed,
}: {
  url: string;
  title: string;
  label?: string;
  onFailed?: (message: string) => void;
}) {
  const preview = useRecordingPreview(url);
  useEffect(() => {
    if (preview.failed) onFailed?.("could not be played");
  }, [preview.failed, onFailed]);
  return (
    <Button variant="ghost" size="icon-xs" title={title} aria-label={label} onClick={preview.toggle}>
      {preview.playing ? <Pause /> : <Play />}
    </Button>
  );
}

/** The live version as a trigger, opening every recording the file has had. */
function RecordingHistory({
  source,
  file,
  live,
  onChanged,
}: {
  source: Source;
  file: string;
  live: LiveRecording;
  onChanged: () => void;
}) {
  const lang = useLang();
  // Read here, the one place it matters: one's own recordings are one's to remove, and an
  // admin's are everyone's.
  const { data: session } = useSession();
  const viewerId = session?.user.id ?? null;
  const admin = session?.user.role === "admin";
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Recording[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(withLang(lang, `/api/recordings?${new URLSearchParams({ source, file })}`));
      if (!response.ok) {
        setError(`could not read the recordings (${response.status})`);
        return;
      }
      setList(((await response.json()) as { recordings: Recording[] }).recordings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [lang, source, file]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function remove(version: number) {
    setBusy(version);
    setError(null);
    try {
      const params = new URLSearchParams({ source, file, version: String(version) });
      const response = await fetch(withLang(lang, `/api/recordings?${params}`), { method: "DELETE" });
      if (!response.ok) {
        setError(`could not remove v${version} (${response.status})`);
        return;
      }
      onChanged();
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`v${live.version} is live; ${Math.round(live.durationSec * 10) / 10}s ${live.format}`}
          aria-label="Every recording of this line"
          className={cn(
            "text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-0.5 rounded-sm font-mono",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
          )}
        >
          v{live.version}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="mb-2 text-sm font-medium">Recordings</div>
        {error && (
          <p role="alert" className="text-destructive mb-2 text-xs">
            {error}
          </p>
        )}
        {list === null ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {list.map((recording) => {
              const removed = recording.deletedAt !== null;
              const mayRemove = !removed && (admin || recording.createdBy === viewerId);
              return (
                <li
                  key={recording.version}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-1.5 py-1 text-xs",
                    recording.version === live.version && "bg-muted",
                  )}
                >
                  <PlayButton
                    url={recordingAudioUrl(lang, source, file, recording.version)}
                    title="Play this recording"
                    onFailed={setError}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className={cn("font-mono", removed && "line-through")}>v{recording.version}</span>
                      <span className="text-muted-foreground">{recording.format}</span>
                      {recording.version === live.version && <span className="text-emerald-400">live</span>}
                      {removed && <span className="text-muted-foreground">removed</span>}
                    </div>
                    <div className="text-muted-foreground truncate">
                      {when(recording.createdAt)} · {recording.credit}
                      {recording.originalName && ` · ${recording.originalName}`}
                    </div>
                  </div>
                  {mayRemove && (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy !== null}
                      onClick={() => void remove(recording.version)}
                      title={
                        recording.version === live.version
                          ? "Remove it; the recording before it, if any, ships instead"
                          : "Remove it from the history"
                      }
                    >
                      {busy === recording.version ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
