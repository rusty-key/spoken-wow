"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { withLang } from "@/lib/lang";

import { useLang } from "./LangProvider";

// Writing a name in the page's language that the English corpus has: a quest's, an NPC's, a
// book's owner's, a place's.
//
// One dialog because a translation is the same job whatever is being named: the English above,
// the box below, the versions behind it. The readables and places editors keep
// their own dialogs because they edit English too, with fields a translation does not have.

type Version = {
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited" | "contributed" | "community";
  note: string | null;
  createdAt: string;
  name: string;
};

const ROUTE = "/api/names";

export type TranslateSubject = {
  kind: string;
  entityId: string;
  /** What the dialog is headed with. */
  title: string;
  subtitle?: string;
  /** The English being translated. */
  english: string;
  /** This language's current wording, or null where there is none yet. */
  current: string | null;
};

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
    const params = new URLSearchParams({ kind: subject.kind, entityId: subject.entityId });
    fetch(withLang(lang, `${ROUTE}?${params}`))
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

  if (!subject) return null;

  const trimmed = value.trim();
  const changed = trimmed !== "" && trimmed !== (subject.current ?? "").trim();

  async function save() {
    const named = subject!;
    setBusy(true);
    setError(null);
    const res = await fetch(withLang(lang, ROUTE), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: named.kind,
        entityId: named.entityId,
        name: value,
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
    const data = (await res.json()) as { version: Version };
    onSaved(named, data.version.name);
    onClose();
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

      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="border-border bg-background w-full rounded border p-2 text-sm"
        onKeyDown={(event) => {
          if (event.key === "Enter" && changed) {
            event.preventDefault();
            void save();
          }
        }}
      />

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
                  {version.note ?? version.name}
                </span>
                {version.isCurrent ? (
                  <span className="ml-auto shrink-0 text-emerald-400">live</span>
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
