"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Scissors, Trash2 } from "lucide-react";

import { useLang } from "@/components/LangProvider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { displayName } from "@/lib/voices/names";
import {
  DEFAULT_REFERENCE_SECONDS as DEFAULT_SECONDS,
  MAX_REFERENCE_SECONDS as MAX_SECONDS,
  MIN_REFERENCE_SECONDS as MIN_SECONDS,
  rejectWindow,
} from "@/lib/voices/reference-window";
import type { Reference } from "@/lib/voices/references";
import type { Sample } from "@/lib/voices/samples";

/**
 * The window of one clip that fish.audio speaks this slot from, and what is said in it.
 *
 * Kept apart from VoiceSamples because nothing about it is ElevenLabs': there is no clone and
 * no account, just a cut, a transcript and a row. The first clip's first twenty seconds are
 * offered before anybody chooses, so for most slots making a reference is one click.
 */
export type ReferenceView = Pick<
  Reference,
  "sample" | "startSec" | "endSec" | "transcript" | "clipHash" | "pinned"
>;

type Props = {
  voice: string;
  samples: Sample[];
  /** Whether voice/seed-clips has clips for this voice in this language. */
  hasSeedClips: boolean;
  /** The clips after an import, for the page to hold. */
  onSamples: (samples: Sample[]) => void;
  initial: ReferenceView | null;
  onChange: (reference: ReferenceView | null) => void;
};

export default function FishReference({
  voice,
  samples,
  hasSeedClips,
  onSamples,
  initial,
  onChange,
}: Props) {
  const lang = useLang();
  const t = useUiText();
  const words = t.voices.reference;
  const [reference, setReference] = useState(initial);
  const [chosen, setChosen] = useState(initial?.sample ?? "");
  // Worked out each render, because the clips above can be added or deleted while this panel
  // is open: a choice that no longer exists falls back to the first clip, rather than
  // leaving the button disabled or posting a file that is gone.
  const sample = samples.some((clip) => clip.file === chosen) ? chosen : (samples[0]?.file ?? "");
  const [start, setStart] = useState(String(initial?.startSec ?? 0));
  const [length, setLength] = useState(
    String(initial ? initial.endSec - initial.startSec : DEFAULT_SECONDS),
  );
  const [duration, setDuration] = useState<number | null>(null);
  const [transcript, setTranscript] = useState(initial?.transcript ?? "");
  const [busy, setBusy] = useState<"import" | "cut" | "transcript" | "pin" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The chosen clip's length, from its metadata, so a window past its end is refused here
  // rather than cut short by ffmpeg into something under ten seconds.
  useEffect(() => {
    if (!sample) return;
    setDuration(null);
    const audio = new Audio(withLang(lang, `/api/voices/${voice}/samples/${sample}`));
    audio.preload = "metadata";
    const loaded = () => {
      if (!Number.isFinite(audio.duration)) return;
      setDuration(audio.duration);
      // Shortened to fit a clip that cannot hold the default, never below the minimum.
      if (!reference && audio.duration < DEFAULT_SECONDS) {
        setLength(String(Math.max(MIN_SECONDS, Math.floor(audio.duration))));
      }
    };
    audio.addEventListener("loadedmetadata", loaded);
    return () => audio.removeEventListener("loadedmetadata", loaded);
    // The reference only seeds the length; re-running when it changes would undo an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, voice, sample]);

  const startSec = Number(start);
  const endSec = startSec + Number(length);
  // The server's own check, then the one only the browser can make: whether the clip is long
  // enough to hold the window at all.
  const why = !sample
    ? words.addClipFirst
    : (rejectWindow(startSec, endSec) ??
      (duration !== null && endSec > duration + 0.05
        ? fill(words.tooShort, { seconds: duration.toFixed(1) })
        : null));

  async function send(kind: "cut" | "transcript" | "pin" | "delete", init: RequestInit) {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(withLang(lang, `/api/voices/${voice}/reference`), {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      // A failure may be a proxy's page rather than the route's JSON: its status is the message. A
      // success that does not parse throws, and the panel keeps what it showed.
      const body = (await (response.ok ? response.json() : response.json().catch(() => ({})))) as { reference?: ReferenceView | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? fill(words.requestFailed, { status: response.status }));
      const next = body.reference ?? null;
      setReference(next);
      setTranscript(next?.transcript ?? "");
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Seed the clips from voice/seed-clips, the same import the ElevenLabs tab offers, so a
   * reference can be cut without a detour there. Only ever from empty: replacing clips is
   * that tab's, where they are listed.
   */
  async function importSeedClips() {
    setBusy("import");
    setError(null);
    try {
      const response = await fetch(withLang(lang, `/api/voices/${voice}/samples/import`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: false }),
      });
      // A failure may be a proxy's page rather than the route's JSON: its status is the message. A
      // success that does not parse throws, and the panel keeps what it showed.
      const body = (await (response.ok ? response.json() : response.json().catch(() => ({})))) as { samples?: Sample[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? fill(words.importFailed, { status: response.status }));
      onSamples(body.samples ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="text-sm">
      <h3 className="mb-1 font-medium">{words.title}</h3>
      <p className="text-muted-foreground mb-3 text-xs">
        {fill(words.lede, { min: MIN_SECONDS, max: MAX_SECONDS })}
      </p>

      {error && (
        <p role="alert" className="text-destructive mb-2 text-xs">
          {error}
        </p>
      )}

      {samples.length === 0 ? (
        hasSeedClips ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              title={fill(words.importSeed, { voice })}
              onClick={importSeedClips}
            >
              {busy === "import" ? <Loader2 className="animate-spin" /> : <Download />}
              {t.voices.samples.importSeedShort}
            </Button>
            <span className="text-muted-foreground text-xs">
              {words.none}
            </span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {words.noClipsNoSeed}
          </p>
        )
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`${voice}-reference-clip`} className="text-xs">
              {words.clip}
            </Label>
            <select
              id={`${voice}-reference-clip`}
              value={sample}
              onChange={(event) => setChosen(event.target.value)}
              className="border-input bg-background h-8 max-w-64 rounded-md border px-2 text-xs"
            >
              {samples.map((clip) => (
                <option key={clip.file} value={clip.file}>
                  {displayName(clip.file)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${voice}-reference-start`} className="text-xs">
              {words.from}
            </Label>
            <Input
              id={`${voice}-reference-start`}
              type="number"
              min={0}
              step={0.5}
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="h-8 w-20"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${voice}-reference-length`} className="text-xs">
              {words.length}
            </Label>
            <Input
              id={`${voice}-reference-length`}
              type="number"
              min={MIN_SECONDS}
              max={MAX_SECONDS}
              step={0.5}
              value={length}
              onChange={(event) => setLength(event.target.value)}
              className="h-8 w-20"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || why !== null}
            title={why ?? undefined}
            onClick={() =>
              send("cut", { method: "POST", body: JSON.stringify({ sample, startSec, endSec }) })
            }
          >
            {busy === "cut" ? <Loader2 className="animate-spin" /> : <Scissors />}
            {reference ? words.reCut : words.cut}
          </Button>
          {why && <span className="text-muted-foreground text-xs">{why}</span>}
        </div>
      )}

      {reference && (
        <div className="mt-3 grid gap-2">
          <audio
            controls
            preload="none"
            // The hash in the URL makes a re-cut clip a new resource, not a cached old one.
            src={withLang(lang, `/api/voices/${voice}/reference/audio?v=${reference.clipHash}`)}
            className="h-8 w-full max-w-md"
          />
          <Label htmlFor={`${voice}-reference-text`} className="text-xs">
            {words.transcript}
          </Label>
          <textarea
            id={`${voice}-reference-text`}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            rows={3}
            className="border-input bg-background w-full max-w-xl rounded-md border px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null || transcript.trim() === "" || transcript === reference.transcript}
              onClick={() =>
                send("transcript", { method: "PATCH", body: JSON.stringify({ transcript }) })
              }
            >
              {busy === "transcript" && <Loader2 className="animate-spin" />}
              {words.saveTranscript}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => send("delete", { method: "DELETE" })}
            >
              {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {words.remove}
            </Button>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${voice}-reference-pinned`}
              checked={reference.pinned}
              disabled={busy !== null}
              onCheckedChange={(on) =>
                send("pin", { method: "PATCH", body: JSON.stringify({ pinned: on === true }) })
              }
            />
            <Label htmlFor={`${voice}-reference-pinned`} className="grid gap-0.5 text-xs font-normal">
              <span className="font-medium">{words.alwaysUse}</span>
              <span className="text-muted-foreground">
                {words.pinNote}
              </span>
            </Label>
          </div>
        </div>
      )}
    </section>
  );
}
