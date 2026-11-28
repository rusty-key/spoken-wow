"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiKeyStatus } from "@/lib/api-key";
import { fill } from "@/lib/site-text/format";
import { KEY_PROVIDER_NAME, type KeyProvider } from "@/lib/generation/providers";
import type { UiText } from "@/lib/ui-text/en";

type KeyWords = UiText["apiKeys"];

/** What differs between the providers' sections: where the key goes, and which words say what. */
const COPY: Record<
  KeyProvider,
  {
    endpoint: string;
    mask: string;
    before: keyof KeyWords;
    after: keyof KeyWords;
    placeholder: keyof KeyWords;
    checked: `keyChecked${string}` & keyof UiText["profile"];
  }
> = {
  elevenlabs: {
    endpoint: "/api/profile/api-key",
    mask: "sk_…••••",
    before: "elevenLabsBefore",
    after: "elevenLabsAfter",
    placeholder: "placeholderEleven",
    checked: "keyCheckedEleven",
  },
  fish: {
    endpoint: "/api/profile/fish-key",
    mask: "••••",
    before: "fishBefore",
    after: "fishAfter",
    placeholder: "placeholderFish",
    checked: "keyCheckedFish",
  },
  gemini: {
    endpoint: "/api/profile/gemini-key",
    mask: "••••",
    before: "geminiBefore",
    after: "geminiAfter",
    placeholder: "placeholderGemini",
    checked: "keyCheckedGemini",
  },
  anthropic: {
    endpoint: "/api/profile/anthropic-key",
    mask: "sk-ant-…••••",
    before: "anthropicBefore",
    after: "anthropicAfter",
    placeholder: "placeholderAnthropic",
    checked: "keyCheckedAnthropic",
  },
};

/**
 * Where a collaborator puts a provider's key, and the only place its existence is shown.
 *
 * The input is emptied the moment a save succeeds, and the key is never read back from the
 * server -- there is no reveal control and no round trip that could carry one. What is drawn
 * instead is the hint the server stored: four characters, which prove a key is set and spend
 * nothing.
 */
export default function ApiKeySection({
  initial,
  provider = "elevenlabs",
}: {
  initial: ApiKeyStatus | null;
  provider?: KeyProvider;
}) {
  const t = useUiText();
  const words = t.apiKeys;
  const copy = COPY[provider];
  // Re-rendered from the server after a save or a removal, because other sections of the page
  // depend on which keys exist: the generator choice offers fish.audio only once it has one.
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [entry, setEntry] = useState("");
  // Replacing is a separate state from having none, so a set key cannot be overwritten by a
  // stray paste into a field that was sitting there open.
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(copy.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entry.trim() }),
      });
      const body = (await response.json()) as { status?: ApiKeyStatus; error?: string };
      if (!response.ok || !body.status) throw new Error(body.error ?? words.couldNotSave);
      setStatus(body.status);
      setEntry("");
      setReplacing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(copy.endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error(words.couldNotRemove);
      setStatus(null);
      setReplacing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const entering = status === null || replacing;

  return (
    // Anchored so /voices can send somebody straight to the key its Activate is waiting on.
    <section id={`${provider}-key`} className="max-w-xl scroll-mt-20">
      <h2 className="mb-1 font-medium">{fill(words.title, { provider: KEY_PROVIDER_NAME[provider] })}</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        {words[copy.before]}
        <strong className="text-foreground">{t.profile.yourOwn}</strong>
        {words[copy.after]}
      </p>

      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      {status && (
        <p className="mb-3 text-sm">
          <span className="bg-muted rounded border px-2 py-0.5 font-mono">
            {copy.mask}
            {status.hint}
          </span>
          <span className="text-muted-foreground ml-3 text-xs">
            {status.tier && <>{fill(words.planTier, { tier: status.tier })} · </>}
            {status.verifiedAt
              ? fill(words.verified, { when: new Date(status.verifiedAt).toISOString().slice(0, 10) })
              : words.notVerified}
          </span>
        </p>
      )}

      {entering ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={entry}
            autoComplete="off"
            placeholder={words[copy.placeholder]}
            aria-label={fill(t.profile.addKey, { provider: KEY_PROVIDER_NAME[provider] })}
            onChange={(event) => setEntry(event.target.value)}
            className="w-80 font-mono"
          />
          <Button type="button" disabled={busy || entry.trim() === ""} onClick={save}>
            {busy ? words.checking : words.save}
          </Button>
          {replacing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEntry("");
                setReplacing(false);
                setError(null);
              }}
            >
              {words.cancel}
            </Button>
          )}
          <span className="text-muted-foreground w-full text-xs">
            {t.profile[copy.checked]}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
            {words.replace}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={remove}>
            {words.remove}
          </Button>
        </div>
      )}
    </section>
  );
}
