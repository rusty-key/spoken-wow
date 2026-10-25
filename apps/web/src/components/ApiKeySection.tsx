"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiKeyStatus } from "@/lib/api-key";
import { PROVIDER_NAME, type Provider } from "@/lib/generation/providers";

type StoredProvider = Exclude<Provider, "voicestudio">;

/** What differs between the two providers' sections: the words, and where the key goes. */
const COPY: Record<
  StoredProvider,
  { endpoint: string; mask: string; placeholder: string; checked: string }
> = {
  elevenlabs: {
    endpoint: "/api/profile/api-key",
    mask: "sk_…••••",
    placeholder: "sk_…",
    checked: "Checked against ElevenLabs before it is stored, which costs no credits.",
  },
  fish: {
    endpoint: "/api/profile/fish-key",
    mask: "••••",
    placeholder: "fish.audio API key",
    checked: "Checked against fish.audio before it is stored, which costs nothing.",
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
  provider?: StoredProvider;
}) {
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
      if (!response.ok || !body.status) throw new Error(body.error ?? "could not save that key");
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
      if (!response.ok) throw new Error("could not remove that key");
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
      <h2 className="mb-1 font-medium">{PROVIDER_NAME[provider]} key</h2>
      {provider === "elevenlabs" ? (
        <p className="text-muted-foreground mb-4 text-sm">
          Regenerating a line, cloning a voice and previewing a pronunciation all spend credits
          from <strong className="text-foreground">your own</strong> ElevenLabs account, so this
          site needs a key of yours. It is encrypted before it is stored and is never shown
          again — only its last four characters. Find yours under your ElevenLabs profile, in
          API keys.
        </p>
      ) : (
        <p className="text-muted-foreground mb-4 text-sm">
          fish.audio is a second generator, spent from{" "}
          <strong className="text-foreground">your own</strong> prepaid fish.audio balance by
          the byte of text. It is optional: without a key everything here uses ElevenLabs, and with one you choose it
          per language on Voices. Like
          the ElevenLabs key it is encrypted before it is stored and never shown again. Find
          yours on fish.audio, under API keys.
        </p>
      )}

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
            {status.tier && <>{status.tier} plan · </>}
            {status.verifiedAt
              ? `verified ${new Date(status.verifiedAt).toISOString().slice(0, 10)}`
              : "not verified"}
          </span>
        </p>
      )}

      {entering ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={entry}
            autoComplete="off"
            placeholder={copy.placeholder}
            aria-label={`${PROVIDER_NAME[provider]} API key`}
            onChange={(event) => setEntry(event.target.value)}
            className="w-80 font-mono"
          />
          <Button type="button" disabled={busy || entry.trim() === ""} onClick={save}>
            {busy ? "Checking…" : "Save"}
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
              Cancel
            </Button>
          )}
          <span className="text-muted-foreground w-full text-xs">
            {copy.checked}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={remove}>
            Remove
          </Button>
        </div>
      )}
    </section>
  );
}
