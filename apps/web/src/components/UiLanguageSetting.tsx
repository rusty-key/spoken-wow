"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { allLangs, type Lang } from "@/lib/lang";
import { nativeName } from "@/lib/site-text/names";

/**
 * The language Backstage is read in, saved on the account. Unlike the header's switcher, it
 * changes only the words, never the `[lang]` segment, so it survives the next link opened.
 */
export default function UiLanguageSetting({ initial }: { initial: Lang | null }) {
  const t = useUiText().interface;
  const refresh = useRouter().refresh;
  const [saved, setSaved] = useState<Lang | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: string) {
    const value = next === FALLBACK ? null : (next as Lang);
    setBusy(true);
    setError(null);
    const response = await fetch("/api/profile/ui-language", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: value }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? t.saveFailed);
      return;
    }
    setSaved(value);
    // The server tree reads the setting, so it must re-render; a refresh keeps scroll and state.
    refresh();
  }

  return (
    <section className="flex max-w-md flex-col gap-1.5 text-sm">
      <label className="flex items-center gap-3">
        <span className="text-muted-foreground w-24 shrink-0">{t.label}</span>
        <Select value={saved ?? FALLBACK} onValueChange={choose} disabled={busy}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={FALLBACK}>{t.followPage}</SelectItem>
            {allLangs().map((code) => (
              <SelectItem key={code} value={code}>
                {nativeName(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <p className="text-muted-foreground">{t.hint}</p>
      {error ? (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The value meaning "no choice": the page's own language decides. Not a language code. */
const FALLBACK = "auto";
