"use client";

import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import type { ResultLine } from "@/lib/readables/search";

// Rewriting a page, and putting an earlier wording back.
//
// The last thing the three explorers disagreed about. book_line has been versioned since
// it was created -- an origin of 'extracted' or 'edited', an editedBy, a note -- and until
// now nothing ever wrote an 'edited' row, so a mistake somebody reported in a book could be
// read, triaged and regenerated, but never actually fixed. That made feedback about a book
// a queue of things nobody could act on.
//
// Not a shared component with places' LoreDialog, though the chrome is the same. The two
// differ in what a line IS: a zone line carries a full text and a short summary derived
// from it, and can be untranslated; a page carries one text and is never either. Sharing
// them would mean a field-schema abstraction, which is more machinery than the duplicated
// markup costs -- and the two would still need separate endpoints, because the tables have
// different structural columns to carry along.
//
// Saving does not regenerate. The page becomes stale -- its text no longer hashes to what
// was spoken -- and joins the regeneration worklist, where spending credits stays a
// separate, deliberate act.

type Version = {
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited" | "contributed" | "community";
  text: string;
  note: string | null;
  createdAt: string;
};

type Props = {
  line: ResultLine | null;
  onClose: () => void;
  /** Told the new text so the row can update without a reload. */
  onSaved: (line: ResultLine, text: string) => void;
};

export function PageTextDialog({ line, onClose, onSaved }: Props) {
  const lang = useLang();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the edit started from. Sent back on save, so a page someone else rewrote in the
  // meantime is a visible conflict rather than a silent overwrite of their work.
  const [baseVersion, setBaseVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!line) {
      dialog.current?.close();
      return;
    }

    // An untranslated page carries the English only so the explorer has something to show;
    // the box starts empty, and the English to work from is shown above it instead.
    setText(line.missing?.text ? "" : line.text);
    setNote("");
    setError(null);
    setVersions(null);
    setBaseVersion(null);
    if (!dialog.current?.open) dialog.current?.showModal();

    let cancelled = false;
    const params = new URLSearchParams({ lineId: line.id });

    fetch(withLang(lang, `/api/readables/text?${params}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("could not load history"))))
      .then((data: { versions: Version[] }) => {
        if (cancelled) return;
        setVersions(data.versions);
        setBaseVersion(data.versions.find((v) => v.isCurrent)?.version ?? null);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [line, lang]);

  const save = useCallback(async () => {
    if (!line) return;
    setBusy(true);
    setError(null);

    const res = await fetch(withLang(lang, "/api/readables/text"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lineId: line.id,
        text,
        note: note.trim() || null,
        expectedVersion: baseVersion,
      }),
    }).catch(() => null);

    setBusy(false);

    if (!res || !res.ok) {
      const message = res
        ? ((await res.json().catch(() => ({}))).error ?? res.statusText)
        : "network error";
      setError(String(message));
      return;
    }

    onSaved(line, text.trim());
    onClose();
  }, [baseVersion, line, note, onClose, onSaved, text]);

  const restore = useCallback(
    async (version: number) => {
      if (!line) return;
      setBusy(true);
      setError(null);

      const res = await fetch(withLang(lang, "/api/readables/text"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineId: line.id, version }),
      }).catch(() => null);

      setBusy(false);

      if (!res || !res.ok) {
        setError("could not restore that version");
        return;
      }

      const data = (await res.json()) as { version: { text: string } };
      onSaved(line, data.version.text);
      onClose();
    },
    [line, onClose, onSaved],
  );

  if (!line) return null;

  const changed = text.trim() !== line.text.trim();

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="border-border bg-muted text-foreground fixed top-1/2 left-1/2 w-[46rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 backdrop:bg-black/60"
    >
      <h2 className="font-medium">{line.title}</h2>
      <p className="text-muted-foreground mb-3 text-xs">
        {line.pageCount > 1 ? `page ${line.pageNumber} of ${line.pageCount}` : "one page"} ·{" "}
        {line.file}
      </p>

      {/* The English page, when this is a translation: to read beside the box. */}
      {line.english !== undefined ? (
        <p className="text-muted-foreground bg-muted mb-2 max-h-40 overflow-y-auto rounded p-2 text-xs whitespace-pre-wrap">
          {line.english}
        </p>
      ) : null}

      <textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={14}
        className="border-border bg-background w-full rounded border p-2 font-mono text-sm leading-relaxed"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />

      <div className="text-muted-foreground mt-1 flex items-baseline justify-between text-xs">
        <span>{text.trim().length} characters</span>
        {changed && (
          <span className="text-amber-400">
            saving marks the audio stale — regenerating it stays a separate step
          </span>
        )}
      </div>

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why this change? (optional, kept with the version)"
        className="border-border bg-background mt-3 w-full rounded border p-2 text-sm"
      />

      {error && <p className="text-destructive mt-2 text-sm">{error}</p>}

      {versions !== null && versions.length > 1 && (
        <details className="mt-3">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
            {versions.length} versions
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
            {versions.map((version) => (
              <li key={version.version} className="flex items-baseline gap-2">
                <span className="text-muted-foreground w-8 shrink-0 font-mono">
                  v{version.version}
                </span>
                <span className="text-muted-foreground w-20 shrink-0 truncate">
                  {version.origin}
                </span>
                <span className="text-muted-foreground truncate" title={version.text}>
                  {version.note ?? version.text}
                </span>
                {version.isCurrent ? (
                  <span className="ml-auto shrink-0 text-emerald-400">live</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restore(version.version)}
                    title="Make this the live text"
                    className="text-muted-foreground/50 hover:bg-accent hover:text-foreground ml-auto shrink-0 rounded p-1"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="text-muted-foreground mr-auto text-xs">⌘↵ to save</span>
        <button
          type="button"
          onClick={onClose}
          className="border-border hover:bg-accent rounded border px-3 py-1"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !changed}
          onClick={() => void save()}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded px-3 py-1 hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          Save
        </button>
      </div>
    </dialog>
  );
}
