"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { allLangs, type Lang } from "@/lib/lang";
import { nativeName } from "@/lib/site-text/names";

/**
 * The language Backstage is read in, saved on the account.
 *
 * Unlike the header's switcher, which moves the page between `[lang]` segments (where a page
 * lives and what its lines are in), this changes only the words on the buttons -- so it is on
 * the profile page, beside the other things that belong to the person, and it survives the
 * next link they open.
 *
 * "The page's own language" is the fallback, not a synonym for English: it is what somebody
 * with no setting gets, and what a signed-out visitor gets.
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
    // The words on this page are already rendered from the old choice; a refresh re-renders
    // the server tree, which is what reads the setting. Not a full reload: the page keeps
    // its scroll and its state.
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
