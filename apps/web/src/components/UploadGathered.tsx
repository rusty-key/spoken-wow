"use client";

/**
 * Sending everything the addon gathered in the background, as the file the game wrote.
 *
 * The file is read in the browser and only the envelopes in it are sent: the rest of a saved
 * variables file is the player's settings, which are nobody's business here. Each envelope is
 * previewed with the same check the single-link form uses, so what the player is told they are
 * sending is what the server will take.
 */
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { envelopesFromSavedVariables } from "@/lib/contributions/saved-variables";
import { parseGatheredEnvelope, type Envelope } from "@/lib/contributions/envelope";
import { sightingFrom } from "@/lib/contributions/sighting";
import { plural } from "@/lib/plural";
import { sendFailureMessage } from "@/lib/contributions/send-failure";
import { sendInChunks } from "@/lib/contributions/upload";

import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import type { UiText } from "@/lib/ui-text/en";
import { previewOf } from "./ContributeForm";

const SOURCE_LABELS: Record<string, string> = {
  quests: "quest and conversation lines",
  readables: "book pages",
  seen: "characters, with the zones you met them in",
};

type Loaded = { envelopes: string[]; counts: Record<string, number>; unreadable: number; titles: string[] };

function summarise(candidates: readonly string[], t: UiText["contribute"]): Loaded {
  const counts: Record<string, number> = {};
  const titles = new Set<string>();
  const envelopes: string[] = [];
  let unreadable = 0;
  for (const envelope of candidates) {
    // Where the player met an NPC: no line to preview, only whether it reads.
    const gathered = parseGatheredEnvelope(envelope);
    if (gathered.ok && gathered.value.source === "seen") {
      if (sightingFrom(gathered.value as Envelope<"seen">)) {
        envelopes.push(envelope);
        counts.seen = (counts.seen ?? 0) + 1;
      } else {
        unreadable += 1;
      }
      continue;
    }
    const preview = previewOf(envelope, t);
    if (!preview.ok) {
      unreadable += 1;
      continue;
    }
    envelopes.push(envelope);
    counts[preview.source] = (counts[preview.source] ?? 0) + 1;
    // By the parser's own key, not the label the reader sees: the label is translated.
    const title = preview.rows.find((row) => row.key === "title" || row.key === "book")?.value;
    if (title) titles.add(title);
  }
  return { envelopes, counts, unreadable, titles: [...titles] };
}

const NOTHING_CARRIED = { accepted: 0, refused: 0, seen: 0 };

function gotten(lines: number, seen: number, t: UiText["contribute"]): string {
  const parts = [
    lines || !seen ? plural(lines, "line") : "",
    seen ? fill(t.whereMet, { what: plural(seen, "character") }) : "",
  ];
  return parts.filter(Boolean).join(" and ");
}

export default function UploadGathered({ signedInAs }: { signedInAs: string | null }) {
  const t = useUiText().contribute;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [carried, setCarried] = useState(NOTHING_CARRIED);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accepted: number; refused: number; seen: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function read(file: File | undefined) {
    // A send finishing would overwrite whatever was picked while it ran.
    if (busy) return;
    setError(null);
    setResult(null);
    setCarried(NOTHING_CARRIED);
    if (!file) return;
    setFileName(file.name);
    const next = summarise(envelopesFromSavedVariables(await file.text()), t);
    if (next.envelopes.length === 0) {
      setLoaded(null);
      setError(
        next.unreadable ? t.nothingReadable : t.nothingGathered,
      );
      return;
    }
    setLoaded(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded) return;
    setBusy(true);
    setProgress(0);
    setError(null);
    const data = new FormData(event.currentTarget);
    const outcome = await sendInChunks(
      loaded.envelopes,
      (envelopes) =>
        fetch("/api/contributions/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            envelopes,
            name: signedInAs ? null : data.get("name"),
            email: signedInAs ? null : data.get("email"),
            website: data.get("website"),
          }),
        }).catch(() => null),
      setProgress,
      carried,
    );
    setBusy(false);

    if (outcome.failedWith === undefined) {
      setResult({ accepted: outcome.accepted, refused: outcome.refused, seen: outcome.seen });
      setCarried(NOTHING_CARRIED);
      setLoaded(null);
      return;
    }
    const message = sendFailureMessage(outcome.failedWith);
    if (outcome.sent === 0) {
      setError(message);
      return;
    }
    // Only what did not arrive stays, so nobody is told to clear lines the site never got.
    const rest = loaded.envelopes.slice(outcome.sent);
    setLoaded(summarise(rest, t));
    setCarried({ accepted: outcome.accepted, refused: outcome.refused, seen: outcome.seen });
    const unused = outcome.refused ? fill(t.someRefused, { n: outcome.refused.toLocaleString() }) : "";
    setError(
      fill(t.someArrived, { n: outcome.accepted.toLocaleString(), unused, message, rest: rest.length.toLocaleString() }),
    );
  }

  if (result) {
    return (
      <p role="status" className="rounded border p-4 text-sm">
        {fill(t.got, { what: gotten(result.accepted, result.seen, t) })}
        {result.refused ? fill(t.someRefused, { n: result.refused.toLocaleString() }) : ""} {t.clearAfter}
      </p>
    );
  }

  const total = loaded?.envelopes.length ?? 0;

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      {/* The whole zone is the drop target and the button, so a file dragged from Finder or
          Explorer lands anywhere on it; the input itself is hidden because the browser's own
          "Choose File / No file chosen" reads as a broken page on a dark theme. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void read(event.dataTransfer.files[0]);
        }}
        className={
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center text-sm transition-colors outline-none focus-visible:ring-3 " +
          (dragging ? "border-primary-ink bg-muted" : "border-muted-foreground/40 hover:border-muted-foreground hover:bg-muted/50")
        }
      >
        <strong>{fileName ?? t.dropLua}</strong>
        <span className="text-muted-foreground">{fileName ? t.dropAnother : t.orClick}</span>
        <input
          ref={input}
          type="file"
          accept=".lua,.bak,text/plain"
          onChange={(event) => void read(event.target.files?.[0])}
          className="hidden"
        />
      </div>

      {loaded ? (
        <section aria-label={t.previewLabel} className="bg-muted rounded border p-3 text-sm">
          <ul className="flex flex-col gap-0.5">
            {Object.entries(loaded.counts).map(([source, count]) => (
              <li key={source}>
                <strong>{count}</strong> {SOURCE_LABELS[source] ?? source}
              </li>
            ))}
            {loaded.unreadable ? <li>{fill(t.couldNotBeRead, { n: loaded.unreadable.toLocaleString() })}</li> : null}
          </ul>
          {loaded.titles.length ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {loaded.titles.slice(0, 12).join(" · ")}
              {loaded.titles.length > 12 ? fill(t.andMore, { n: loaded.titles.length - 12 }) : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {loaded && !signedInAs ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Your name (optional)
            <input name="name" className="bg-background rounded border px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Your email (optional)
            <input name="email" type="email" className="bg-background rounded border px-2 py-1.5" />
          </label>
        </>
      ) : null}

      {/* A honeypot. sr-only rather than display:none, which bots know to skip. */}
      <label className="sr-only" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {loaded ? (
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? `Sending…${progress ? ` ${progress}/${total}` : ""}` : `Send ${total} ${total === 1 ? "line" : "lines"}`}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
