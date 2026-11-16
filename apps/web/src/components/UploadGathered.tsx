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
import { sendFailureMessage } from "@/lib/contributions/send-failure";
import { sendInChunks } from "@/lib/contributions/upload";

import { previewOf } from "./ContributeForm";

const SOURCE_LABELS: Record<string, string> = { quests: "quest and conversation lines", readables: "book pages" };

type Loaded = { envelopes: string[]; counts: Record<string, number>; unreadable: number; titles: string[] };

function summarise(candidates: readonly string[]): Loaded {
  const counts: Record<string, number> = {};
  const titles = new Set<string>();
  const envelopes: string[] = [];
  let unreadable = 0;
  for (const envelope of candidates) {
    const preview = previewOf(envelope);
    if (!preview.ok) {
      unreadable += 1;
      continue;
    }
    envelopes.push(envelope);
    counts[preview.source] = (counts[preview.source] ?? 0) + 1;
    const title = preview.rows.find((row) => row.label === "Title" || row.label === "Book")?.value;
    if (title) titles.add(title);
  }
  return { envelopes, counts, unreadable, titles: [...titles] };
}

const NOTHING_CARRIED = { accepted: 0, refused: 0 };

export default function UploadGathered({ signedInAs }: { signedInAs: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [carried, setCarried] = useState(NOTHING_CARRIED);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accepted: number; refused: number } | null>(null);
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
    const next = summarise(envelopesFromSavedVariables(await file.text()));
    if (next.envelopes.length === 0) {
      setLoaded(null);
      setError(
        next.unreadable
          ? "Nothing in that file could be read. Log out of the game once so it writes the file again, then pick it."
          : "That file holds nothing gathered. It should be SpokenContributions.lua, after gathering was turned on and you logged out.",
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
      setResult({ accepted: outcome.accepted, refused: outcome.refused });
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
    setLoaded(summarise(rest));
    setCarried({ accepted: outcome.accepted, refused: outcome.refused });
    const unused = outcome.refused ? ` ${outcome.refused} could not be used.` : "";
    setError(`${outcome.accepted} lines arrived.${unused} ${message} The other ${rest.length} are still here to send.`);
  }

  if (result) {
    return (
      <p role="status" className="rounded border p-4 text-sm">
        Got {result.accepted} {result.accepted === 1 ? "line" : "lines"} — thank you.
        {result.refused ? ` ${result.refused} could not be used.` : ""} You can clear the collected lines
        in the game now: Spoken's settings, Clear Collected Lines.
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
        <strong>{fileName ?? "Drop SpokenContributions.lua here"}</strong>
        <span className="text-muted-foreground">
          {fileName ? "Drop another file, or click to choose one." : "or click to choose it"}
        </span>
        <input
          ref={input}
          type="file"
          accept=".lua,.bak,text/plain"
          onChange={(event) => void read(event.target.files?.[0])}
          className="hidden"
        />
      </div>

      {loaded ? (
        <section aria-label="What will be sent" className="bg-muted rounded border p-3 text-sm">
          <ul className="flex flex-col gap-0.5">
            {Object.entries(loaded.counts).map(([source, count]) => (
              <li key={source}>
                <strong>{count}</strong> {SOURCE_LABELS[source] ?? source}
              </li>
            ))}
            {loaded.unreadable ? <li>{loaded.unreadable} that could not be read and will be left out</li> : null}
          </ul>
          {loaded.titles.length ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {loaded.titles.slice(0, 12).join(" · ")}
              {loaded.titles.length > 12 ? ` and ${loaded.titles.length - 12} more` : ""}
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
