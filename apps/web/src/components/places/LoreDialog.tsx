"use client";

import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import type { ExplorerLine, ExplorerSection } from "@/components/explorer/section";

// Rewriting a line, and putting an earlier wording back.
//
// The text is the one thing the explorer could not change until now: it could tell you a
// line was wrong, flag it, collect reports about it and pay to have it spoken again, but
// the words came from a file and had to be fixed in a checkout. This is where a fourth-
// wall break or a post-vanilla sentence gets fixed by the person who noticed it.
//
// Saving does not regenerate. The line becomes stale -- its text no longer hashes to what
// was spoken -- and joins the regeneration worklist, where spending credits stays a
// separate, deliberate act.

/** The text is `full` where the section keeps a short text beside it, `text` where it does not. */
type Version = {
  version: number;
  isCurrent: boolean;
  origin: string;
  full?: string;
  text?: string;
  note: string | null;
  createdAt: string;
};

function versionText(version: Version, shortText: boolean): string {
  return (shortText ? version.full : version.text) ?? "";
}

type Props<L extends ExplorerLine> = {
  section: Pick<ExplorerSection<L>, "api" | "textApi" | "shortText" | "chip" | "ownLine">;
  line: L | null;
  onClose: () => void;
  /** Told the new text so the row can update without a reload. */
  onSaved: (line: L, text: string) => void;
};

export function LoreDialog<L extends ExplorerLine>({ section, line, onClose, onSaved }: Props<L>) {
  const lang = useLang();
  const route = `${section.api}/${section.textApi}`;
  // Places derives its short text from `full` on save, so one box writes both.
  const { shortText } = section;
  const field = shortText ? "full" : "text";
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the edit started from. Sent back on save so a line someone else rewrote in the
  // meantime is a visible conflict rather than a silent overwrite of their paragraph.
  const [baseVersion, setBaseVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!line) {
      dialog.current?.close();
      return;
    }

    // An untranslated line carries the English only so the explorer has something to show;
    // the box starts empty, and the English to work from is shown above it instead. A line
    // with no story in the language starts empty too: saving writes its first version.
    setText(line.translated === false ? "" : (line.text ?? ""));
    setNote("");
    setError(null);
    setVersions(null);
    setBaseVersion(null);
    if (!dialog.current?.open) dialog.current?.showModal();

    let cancelled = false;
    const params = new URLSearchParams({ lineId: line.id });

    fetch(withLang(lang, `${route}?${params}`))
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
  }, [line, lang, route]);

  const save = useCallback(async () => {
    if (!line) return;
    setBusy(true);
    setError(null);

    const res = await fetch(withLang(lang, route), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lineId: line.id,
        [field]: text,
        note: note.trim() || null,
        expectedVersion: baseVersion,
      }),
    }).catch(() => null);

    setBusy(false);

    if (!res || !res.ok) {
      const message = res ? ((await res.json().catch(() => ({}))).error ?? res.statusText) : "network error";
      setError(String(message));
      return;
    }

    onSaved(line, text.trim());
    onClose();
  }, [baseVersion, field, lang, line, note, onClose, onSaved, route, text]);

  const restore = useCallback(
    async (version: number) => {
      if (!line) return;
      setBusy(true);
      setError(null);

      const res = await fetch(withLang(lang, route), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineId: line.id, version }),
      }).catch(() => null);

      setBusy(false);

      if (!res || !res.ok) {
        setError("could not restore that version");
        return;
      }

      const data = (await res.json()) as { version: Version };
      onSaved(line, versionText(data.version, shortText));
      onClose();
    },
    [lang, line, onClose, onSaved, route, shortText],
  );

  if (!line) return null;

  const changed = text.trim() !== (line.text ?? "").trim();
  const chip = section.chip(line);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="fixed top-1/2 left-1/2 w-[46rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-muted p-4 text-foreground backdrop:bg-black/60"
    >
      <h2 className="font-medium">{section.ownLine?.(line) && chip !== null ? chip : line.name}</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {chip === null ? line.file : `${chip} · ${line.file}`}
      </p>

      {/* What is being translated, when this is a translation: the English, to read beside
          the box rather than to be edited in it. */}
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
        className="w-full rounded border border-border bg-background p-2 font-mono text-sm leading-relaxed"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />

      <div className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground">
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
        className="mt-3 w-full rounded border border-border bg-background p-2 text-sm"
      />

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {versions !== null && versions.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {versions.length} versions
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
            {versions.map((version) => (
              <li key={version.version} className="flex items-baseline gap-2">
                <span className="w-8 shrink-0 font-mono text-muted-foreground">v{version.version}</span>
                <span className="w-28 shrink-0 truncate text-muted-foreground">{version.origin}</span>
                <span className="truncate text-muted-foreground" title={versionText(version, shortText)}>
                  {version.note ?? versionText(version, shortText)}
                </span>
                {version.isCurrent ? (
                  <span className="ml-auto shrink-0 text-emerald-400">live</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restore(version.version)}
                    title="Make this the live text"
                    className="ml-auto shrink-0 rounded p-1 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
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
        <span className="mr-auto text-xs text-muted-foreground">⌘↵ to save</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-3 py-1 hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !changed}
          onClick={() => void save()}
          className="flex items-center gap-1.5 rounded bg-primary px-3 py-1 text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          Save
        </button>
      </div>
    </dialog>
  );
}
