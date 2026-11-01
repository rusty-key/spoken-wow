"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { withLang } from "@/lib/lang";

import { useLang } from "./LangProvider";

// Writing a name in the page's language that the English corpus has: a quest's, an NPC's, a
// book's owner's, a place's.
//
// One dialog because a translation is the same job whatever is being named: the English above,
// the box below, the versions behind it. What differs is only where it is saved and what
// addresses it, which the caller passes. The readables and places editors keep
// their own dialogs because they edit English too, with fields a translation does not have.

type Version = {
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited" | "contributed" | "community";
  note: string | null;
  createdAt: string;
  /** The field is `text` on a line and `name` on a name. */
  text?: string;
  name?: string;
};

export type TranslateSubject = {
  /** What the dialog is headed with. */
  title: string;
  subtitle?: string;
  /** The English being translated. */
  english: string;
  /** This language's current wording, or null where there is none yet. */
  current: string | null;
  /** The API route, e.g. /api/quests/lines/text or /api/names. */
  endpoint: string;
  /** What addresses the thing on that route: { lineId, variant } or { kind, entityId }. */
  address: Record<string, string | number>;
  /** The field the route calls the text: `text` for a line, `name` for a name. */
  field: "text" | "name";
  /** A line is a paragraph; a name is one line. */
  multiline: boolean;
};

/** A quest line's text, in a language other than English. */
/** A thing's name: a quest's, an NPC's, a book owner's, a place's. */
export function nameSubject(args: {
  kind: string;
  entityId: string;
  title: string;
  subtitle: string;
  english: string;
  /** The language's own name, or null where it has none yet. */
  current: string | null;
}): TranslateSubject {
  return {
    title: args.title,
    subtitle: args.subtitle,
    english: args.english,
    current: args.current,
    endpoint: "/api/names",
    address: { kind: args.kind, entityId: args.entityId },
    field: "name",
    multiline: false,
  };
}

type Props = {
  subject: TranslateSubject | null;
  onClose: () => void;
  onSaved: (subject: TranslateSubject, value: string) => void;
};

export function TranslateDialog({ subject, onClose, onSaved }: Props) {
  const lang = useLang();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subject) {
      dialog.current?.close();
      return;
    }
    setValue(subject.current ?? "");
    setNote("");
    setError(null);
    setVersions(null);
    setBaseVersion(null);
    if (!dialog.current?.open) dialog.current?.showModal();

    let cancelled = false;
    const params = new URLSearchParams(
      Object.entries(subject.address).map(([key, v]) => [key, String(v)]),
    );
    fetch(withLang(lang, `${subject.endpoint}?${params}`))
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
  }, [subject, lang]);

  const send = useCallback(
    async (method: "PUT" | "POST", body: Record<string, unknown>, done: (v: string) => void) => {
      if (!subject) return;
      setBusy(true);
      setError(null);
      const res = await fetch(withLang(lang, subject.endpoint), {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...subject.address, ...body }),
      }).catch(() => null);
      setBusy(false);
      if (!res || !res.ok) {
        const message = res
          ? ((await res.json().catch(() => ({}))).error ?? res.statusText)
          : "network error";
        setError(String(message));
        return;
      }
      const data = (await res.json()) as { version: Version };
      done(data.version[subject.field] ?? "");
    },
    [subject, lang],
  );

  if (!subject) return null;

  const trimmed = value.trim();
  const changed = trimmed !== "" && trimmed !== (subject.current ?? "").trim();

  function save() {
    void send(
      "PUT",
      { [subject!.field]: value, note: note.trim() || null, expectedVersion: baseVersion },
      (saved) => {
        onSaved(subject!, saved);
        onClose();
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="border-border bg-muted text-foreground fixed top-1/2 left-1/2 w-[46rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4 backdrop:bg-black/60"
    >
      <h2 className="font-medium">{subject.title}</h2>
      {subject.subtitle ? (
        <p className="text-muted-foreground mb-3 text-xs">{subject.subtitle}</p>
      ) : null}

      <p className="text-muted-foreground bg-background/50 mb-2 max-h-40 overflow-y-auto rounded p-2 text-xs whitespace-pre-wrap">
        {subject.english}
      </p>

      {subject.multiline ? (
        <textarea
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={10}
          className="border-border bg-background w-full rounded border p-2 text-sm leading-relaxed"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && changed) {
              event.preventDefault();
              save();
            }
          }}
        />
      ) : (
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="border-border bg-background w-full rounded border p-2 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Enter" && changed) {
              event.preventDefault();
              save();
            }
          }}
        />
      )}

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why this wording? (optional, kept with the version)"
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
                <span className="text-muted-foreground w-20 shrink-0 truncate">{version.origin}</span>
                <span className="text-muted-foreground truncate">
                  {version.note ?? version[subject.field]}
                </span>
                {version.isCurrent ? (
                  <span className="ml-auto shrink-0 text-emerald-400">live</span>
                ) : subject.field === "text" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void send("POST", { version: version.version }, (restored) => {
                        onSaved(subject, restored);
                        onClose();
                      })
                    }
                    title="Make this the live text"
                    className="text-muted-foreground/50 hover:bg-accent hover:text-foreground ml-auto shrink-0 rounded p-1"
                  >
                    <RotateCcw size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
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
          onClick={save}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded px-3 py-1 hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          Save
        </button>
      </div>
    </dialog>
  );
}
