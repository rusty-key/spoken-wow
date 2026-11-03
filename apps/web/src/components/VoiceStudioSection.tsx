"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiKeyStatus } from "@/lib/api-key";
import {
  parseConnection,
  VOICESTUDIO_DEFAULT_CONCURRENCY,
  VOICESTUDIO_DEFAULT_MODEL,
  VOICESTUDIO_MAX_CONCURRENCY,
} from "@/lib/generation/voicestudio-connection";

import { useStoredCredential } from "./useStoredCredential";

const ENDPOINT = "/api/profile/voicestudio";
const EMPTY = { baseUrl: "", apiKey: "", model: "", maxConcurrency: "" };

/**
 * Where a collaborator connects their own VoiceStudio service. Nothing stored is read back -- not even the URL, which names
 * somebody's machine -- so replacing it means entering all of it again. What is drawn instead
 * is the host the server stored.
 */
export default function VoiceStudioSection({ initial }: { initial: ApiKeyStatus | null }) {
  const { status, replacing, setReplacing, busy, error, setError, save, remove } = useStoredCredential(
    initial,
    ENDPOINT,
    "service",
  );
  const [entry, setEntry] = useState(EMPTY);
  const { baseUrl, apiKey, model, maxConcurrency } = entry;

  async function saveEntry() {
    // The server checks the same rules; this only saves a round trip for a plain typo.
    const local = parseConnection(entry);
    if (local.error !== null) {
      setError(local.error);
      return;
    }
    if (await save(entry)) setEntry(EMPTY);
  }

  const entering = status === null || replacing;

  return (
    <section id="voicestudio-key" className="max-w-xl scroll-mt-20">
      <h2 className="mb-1 font-medium">VoiceStudio service</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        VoiceStudio is a third generator that runs on{" "}
        <strong className="text-foreground">your own</strong> machine. Serve it over https at an
        address this site can reach; setting that up is yours to do. It is optional, and with it
        connected you choose it per language on Voices. The address and key are encrypted before
        they are stored and never shown again — only the host.
      </p>

      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      {status && (
        <p className="mb-3 text-sm">
          <span className="bg-muted rounded border px-2 py-0.5 font-mono">{status.hint}</span>
          <span className="text-muted-foreground ml-3 text-xs">
            {status.verifiedAt
              ? `verified ${new Date(status.verifiedAt).toISOString().slice(0, 10)}`
              : "not verified"}
          </span>
        </p>
      )}

      {entering ? (
        <div className="grid max-w-md gap-2">
          <Input
            type="url"
            value={baseUrl}
            autoComplete="off"
            placeholder="https://voicestudio.example.com"
            aria-label="VoiceStudio service URL"
            onChange={(event) => setEntry({ ...entry, baseUrl: event.target.value })}
            className="font-mono"
          />
          <Input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder="API key (optional)"
            aria-label="VoiceStudio API key"
            onChange={(event) => setEntry({ ...entry, apiKey: event.target.value })}
            className="font-mono"
          />
          <div className="flex gap-2">
            <Input
              value={model}
              autoComplete="off"
              placeholder={`model (${VOICESTUDIO_DEFAULT_MODEL})`}
              aria-label="VoiceStudio model"
              onChange={(event) => setEntry({ ...entry, model: event.target.value })}
              className="font-mono"
            />
            <Input
              type="number"
              min={1}
              max={VOICESTUDIO_MAX_CONCURRENCY}
              value={maxConcurrency}
              placeholder={`at once (${VOICESTUDIO_DEFAULT_CONCURRENCY})`}
              aria-label="Lines generated at once"
              onChange={(event) => setEntry({ ...entry, maxConcurrency: event.target.value })}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" disabled={busy || baseUrl.trim() === ""} onClick={saveEntry}>
              {busy ? "Checking…" : "Save"}
            </Button>
            {replacing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEntry(EMPTY);
                  setReplacing(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          <span className="text-muted-foreground text-xs">
            Checked by listing the service&apos;s voices before it is stored. The address must be
            public: this site will not call itself or a private network.
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
