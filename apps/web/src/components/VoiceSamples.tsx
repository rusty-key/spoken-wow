"use client";

import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import { useRef, useState } from "react";
import { Combine, Download, Loader2, Sparkles, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import AccountVoicePicker from "@/components/voices/AccountVoicePicker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayName } from "@/lib/voices/names";
import type { Sample } from "@/lib/voices/samples";

/**
 * The clips behind one voice.
 *
 * Duration is read from each <audio> element's metadata rather than measured on the server,
 * which keeps an audio decoder out of the request path. It is the number that matters:
 * ElevenLabs' guidance is that the number of samples is irrelevant and the combined length
 * is what decides clone quality, so that total is the thing this panel exists to show.
 *
 * Merging is here because the realistic source for these voices is short greeting clips, a
 * second or less each. Fifty separate one-second files give the model no continuity; one
 * take with a beat between them does.
 */

const TARGET_MIN_SECONDS = 5;
const TARGET_MAX_SECONDS = 180;
const DEFAULT_PAUSE = 1;
const MAX_PAUSE = 5;

type Action = "upload" | "import" | "merge" | "delete" | "clone";

type Props = {
  voice: string;
  samples: Sample[];
  /** Whether voice/seed-clips has clips for this voice in this language. */
  hasSeedClips: boolean;
  /** Whether a voice of this name already exists in the ElevenLabs account. */
  exists: boolean;
  onChange: (samples: Sample[]) => void;
  onCloned: () => void;
};

export default function VoiceSamples({
  voice,
  samples,
  hasSeedClips,
  exists,
  onChange,
  onCloned,
}: Props) {
  const lang = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pause, setPause] = useState(String(DEFAULT_PAUSE));
  // On by default: cloning sends every clip in the folder, so leaving the originals beside
  // the merge would upload the same audio twice. Untick to keep them.
  const [deleteSources, setDeleteSources] = useState(true);

  async function request(kind: Action, send: () => Promise<Response>) {
    setBusy(kind);
    setError(null);
    try {
      const response = await send();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `${kind} failed (${response.status})`);
      return payload;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function upload(files: FileList) {
    const body = new FormData();
    for (const file of files) body.append("files", file);

    const payload = await request("upload", () =>
      fetch(withLang(lang, `/api/voices/${voice}/samples`), { method: "POST", body }),
    );
    if (payload) onChange(payload.samples);
    // Clearing the input is what lets the same file be re-picked after a failure.
    if (input.current) input.current.value = "";
  }

  async function importSeedClips() {
    const payload = await request("import", () =>
      fetch(withLang(lang, `/api/voices/${voice}/samples/import`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: samples.length > 0 }),
      }),
    );
    if (payload) onChange(payload.samples);
  }

  async function remove(file: string) {
    const payload = await request("delete", () =>
      fetch(withLang(lang, `/api/voices/${voice}/samples/${file}`), { method: "DELETE" }),
    );
    if (!payload) return;
    onChange(samples.filter((sample) => sample.file !== file));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(file);
      return next;
    });
  }

  async function merge() {
    const payload = await request("merge", () =>
      fetch(withLang(lang, `/api/voices/${voice}/samples/merge`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: samples.filter((s) => selected.has(s.file)).map((s) => s.file),
          pauseSeconds: Number(pause),
          deleteSources,
        }),
      }),
    );
    if (!payload) return;
    onChange(payload.samples);
    setSelected(new Set());
  }

  async function clone() {
    const payload = await request("clone", () =>
      fetch(withLang(lang, `/api/voices/${voice}/clone`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: exists }),
      }),
    );
    setConfirmingReplace(false);
    if (payload) onCloned();
  }

  function toggle(file: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }

  // Only clips whose metadata has loaded contribute, so the total is marked approximate
  // until every one has reported.
  const measured = samples.filter((sample) => durations[sample.file] !== undefined);
  const total = measured.reduce((sum, sample) => sum + durations[sample.file], 0);
  const complete = measured.length === samples.length;
  const allSelected = samples.length > 0 && selected.size === samples.length;
  const pauseSeconds = Number(pause);
  const pauseValid =
    Number.isFinite(pauseSeconds) && pauseSeconds >= 0 && pauseSeconds <= MAX_PAUSE;
  return (
    <div className="bg-muted/30 border-t px-4 py-3">
      {samples.length === 0 ? (
        <p className="text-muted-foreground mb-3 text-sm">
          No clips yet.{" "}
          {hasSeedClips
            ? "Import the seed clips for this voice, or upload your own — short greeting clips are fine, and several merge into one take."
            : "Short greeting clips are fine — upload several and merge them into one take."}
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2 text-xs">
            <Checkbox
              id={`${voice}-all`}
              checked={allSelected}
              onCheckedChange={(checked) =>
                setSelected(checked ? new Set(samples.map((s) => s.file)) : new Set())
              }
            />
            <Label htmlFor={`${voice}-all`} className="text-muted-foreground text-xs">
              Select all
            </Label>
          </div>

          <ul className="mb-3 space-y-1">
            {samples.map((sample) => (
              <li key={sample.file} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={selected.has(sample.file)}
                  onCheckedChange={() => toggle(sample.file)}
                  aria-label={`Select ${sample.file}`}
                />
                <audio
                  controls
                  preload="metadata"
                  src={withLang(lang, `/api/voices/${voice}/samples/${sample.file}`)}
                  onLoadedMetadata={(event) => {
                    // Read before the state updater, which runs after the handler returns —
                    // React nulls currentTarget once dispatch ends. A stream whose length is
                    // not yet known reports NaN or Infinity, and recording either would make
                    // the whole total unusable.
                    const { duration } = event.currentTarget;
                    if (!Number.isFinite(duration)) return;
                    setDurations((current) => ({
                      ...current,
                      [sample.file]: duration,
                    }));
                  }}
                  className="h-8 max-w-[16rem] flex-1"
                />
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                  {displayName(sample.file)}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {durations[sample.file] !== undefined &&
                    `${formatDuration(durations[sample.file])} · `}
                  {(sample.bytes / 1024 / 1024).toFixed(1)} MiB
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy !== null}
                  title={`Delete ${sample.file}`}
                  aria-label={`Delete ${sample.file}`}
                  onClick={() => remove(sample.file)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          ref={input}
          type="file"
          multiple
          accept=".mp3,.wav,.m4a,.mp4,.ogg,.flac,.webm,audio/*"
          className="hidden"
          onChange={(event) => event.target.files?.length && upload(event.target.files)}
        />
        <Button
          variant="outline"
          size="xs"
          disabled={busy !== null}
          onClick={() => input.current?.click()}
        >
          {busy === "upload" ? <Loader2 className="animate-spin" /> : <Upload />}
          Add clips
        </Button>

        <AccountVoicePicker
          voice={voice}
          exists={exists}
          disabled={busy !== null}
          onAdopted={onCloned}
        />

        {hasSeedClips && (
          <Button
            variant="outline"
            size="xs"
            disabled={busy !== null}
            title={`Replace these clips with the seed clips for ${voice}, merged into one take`}
            onClick={importSeedClips}
          >
            {busy === "import" ? <Loader2 className="animate-spin" /> : <Download />}
            {samples.length > 0 ? "Re-import seed clips" : "Import seed clips"}
          </Button>
        )}

        {samples.length > 1 && (
          <>
            <Button
              variant="outline"
              size="xs"
              disabled={busy !== null || selected.size < 2 || !pauseValid}
              title={selected.size < 2 ? "Select at least two clips" : undefined}
              onClick={merge}
            >
              {busy === "merge" ? <Loader2 className="animate-spin" /> : <Combine />}
              Merge {selected.size > 1 ? `${selected.size} clips` : "selected"}
            </Button>

            <span className="flex items-center gap-1.5">
              <Label htmlFor={`${voice}-pause`} className="text-muted-foreground text-xs">
                pause
              </Label>
              <Input
                id={`${voice}-pause`}
                type="number"
                min={0}
                max={MAX_PAUSE}
                step={0.5}
                value={pause}
                onChange={(event) => setPause(event.target.value)}
                aria-invalid={!pauseValid}
                className="h-7 w-16 text-xs"
              />
              <span className="text-muted-foreground text-xs">s</span>
            </span>

            <span className="flex items-center gap-1.5">
              <Checkbox
                id={`${voice}-delete-sources`}
                checked={deleteSources}
                onCheckedChange={(checked) => setDeleteSources(checked === true)}
              />
              <Label htmlFor={`${voice}-delete-sources`} className="text-muted-foreground text-xs">
                delete originals
              </Label>
            </span>
          </>
        )}

        {samples.length > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {samples.length} {samples.length === 1 ? "clip" : "clips"} · {complete ? "" : "≥ "}
            {formatDuration(total)}
          </span>
        )}

        <DurationHint seconds={total} known={complete && samples.length > 0} />
      </div>

      {samples.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
          <Button
            size="xs"
            variant={confirmingReplace ? "destructive" : "default"}
            disabled={busy !== null}
            onClick={() => (exists && !confirmingReplace ? setConfirmingReplace(true) : clone())}
          >
            {busy === "clone" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {confirmingReplace ? "Confirm replace" : exists ? "Replace voice" : "Create voice"}
          </Button>

          {confirmingReplace ? (
            <>
              <span className="text-xs text-amber-400">
                This deletes the current <code>{voice}</code> in ElevenLabs and creates a new one
                from these {samples.length} {samples.length === 1 ? "clip" : "clips"}.
              </span>
              <Button variant="ghost" size="xs" onClick={() => setConfirmingReplace(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground text-xs">
              {exists
                ? `Re-clones "${voice}" from the clips above.`
                : `Creates "${voice}" from the clips above, using one voice slot.`}
            </span>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function DurationHint({ seconds, known }: { seconds: number; known: boolean }) {
  if (!known) return null;
  if (seconds > TARGET_MAX_SECONDS) {
    return (
      <span className="text-xs text-amber-400">
        over three minutes — extra audio tends to make the clone less stable
      </span>
    );
  }
  if (seconds < TARGET_MIN_SECONDS) {
    return <span className="text-muted-foreground text-xs">under five seconds — add more</span>;
  }
  return <span className="text-xs text-emerald-400">good length</span>;
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
