"use client";

/**
 * Sending the game's text cache: the BroadcastText rows in Cache/ADB/<locale>/DBCache.bin.
 *
 * Read in the browser (lib/broadcast/cache.ts); only the rows are sent. Several files at once,
 * or the whole folder, because each file holds only the texts of a session or two: the client
 * keeps a DBCache.bin<n>.tmp per session beside the main file.
 *
 * The language is asked for rather than guessed: nothing in the file says which it is, only
 * the folder it came from.
 */
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useFileDrop } from "@/components/useFileDrop";
import type { RecordedTexts } from "@/lib/broadcast/store";
import { parseBroadcastCache, type CachedBroadcastText } from "@/lib/broadcast/cache";
import { BASE_LANG, isClientLang, LOCALES, type Lang } from "@/lib/lang";

const CLIENT_LOCALES = LOCALES.filter((locale) => isClientLang(locale.code));

/** Every text the files hold, grouped by the client build that sent it. */
type Loaded = { files: number; texts: number; byBuild: Map<number, CachedBroadcastText[]> };

/**
 * One copy of each text, from the newest build that has it: DBCache.bin and its .tmp siblings
 * overlap, and the newest build's text is the one the server keeps anyway.
 */
function merge(caches: { build: number; texts: CachedBroadcastText[] }[]): Loaded {
  const newest = new Map<number, { build: number; text: CachedBroadcastText }>();
  for (const { build, texts } of caches) {
    for (const text of texts) {
      const seen = newest.get(text.id);
      if (!seen || build >= seen.build) newest.set(text.id, { build, text });
    }
  }
  const byBuild = new Map<number, CachedBroadcastText[]>();
  for (const { build, text } of newest.values()) byBuild.set(build, [...(byBuild.get(build) ?? []), text]);
  return { files: caches.length, texts: newest.size, byBuild };
}

export default function UploadBroadcastCache({ signedIn, lang }: { signedIn: boolean; lang: Lang }) {
  const [locale, setLocale] = useState<Lang>(isClientLang(lang) ? lang : BASE_LANG);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<RecordedTexts | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const drop = useFileDrop((files) => void read(files));

  if (!signedIn) {
    return (
      <p className="text-sm">
        <Link href="/login" className="underline">
          Sign in
        </Link>{" "}
        to send a cache.
      </p>
    );
  }

  async function read(files: File[]) {
    setError(null);
    setSent(null);
    // A dropped folder brings the client's other cache files too; only these hold text.
    const picked = files.filter((file) => file.name.startsWith("DBCache.bin"));
    if (picked.length === 0) {
      setLoaded(null);
      setError("No DBCache files there. They are in Cache/ADB/<language>/.");
      return;
    }
    const parsed = await Promise.all(
      picked.map(async (file) => {
        try {
          return parseBroadcastCache(await file.arrayBuffer());
        } catch {
          return null;
        }
      }),
    );
    const next = merge(parsed.filter((cache) => cache !== null));
    setLoaded(next.texts > 0 ? next : null);
    if (next.texts === 0) setError("Those files hold no NPC text. Talk to a few NPCs, log out, and pick them again.");
  }

  async function send() {
    if (!loaded) return;
    setBusy(true);
    setError(null);
    const total: RecordedTexts = { texts: 0, added: 0, changed: 0 };
    // One request per client build: the build decides whose text wins on the server.
    for (const [build, texts] of loaded.byBuild) {
      const response = await fetch("/api/broadcast-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: locale, build, texts }),
      }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (!response?.ok) {
        setError(body?.error ?? "That did not go through. Try again in a minute.");
        setBusy(false);
        return;
      }
      total.texts += body.texts;
      total.added += body.added;
      total.changed += body.changed;
    }
    setBusy(false);
    setLoaded(null);
    setSent(total);
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        Game language
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value as Lang)}
          className="bg-background rounded border px-2 py-1"
        >
          {CLIENT_LOCALES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name} ({option.code})
            </option>
          ))}
        </select>
      </label>

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
        {...drop.handlers}
        className={
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center text-sm transition-colors outline-none focus-visible:ring-3 " +
          (drop.over ? "border-primary bg-muted" : "border-muted-foreground/40 hover:border-muted-foreground hover:bg-muted/50")
        }
      >
        <strong>
          {loaded ? `${loaded.files} files, ${loaded.texts} texts` : "Drop the DBCache files or their folder here"}
        </strong>
        <span className="text-muted-foreground">or click to choose them</span>
        <input
          ref={input}
          type="file"
          multiple
          onChange={(event) => void read([...(event.target.files ?? [])])}
          className="hidden"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {sent ? (
        <p role="status" className="rounded border p-4 text-sm">
          Got {sent.texts} texts — {sent.added} new, {sent.changed} updated. Thank you.
        </p>
      ) : null}

      {loaded ? (
        <div>
          <Button onClick={() => void send()} disabled={busy}>
            {busy ? "Sending…" : `Send ${loaded.texts} texts as ${locale}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
