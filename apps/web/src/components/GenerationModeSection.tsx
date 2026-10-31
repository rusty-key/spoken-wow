"use client";

import { useState } from "react";

import Link from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDER_NAME, PROVIDERS, type Provider } from "@/lib/generation/providers";
import type { GenerationMode as Mode } from "@/lib/worker/protocol";

type Manager = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

/**
 * The pairing code arrives in the URL when the Manager opens this page for its owner, and can
 * be typed in otherwise.
 */
export default function GenerationModeSection({
  initialModes,
  initialManagers,
  pairCode,
}: {
  initialModes: Record<Provider, Mode>;
  initialManagers: Manager[];
  pairCode: string | null;
}) {
  const [modes, setModes] = useState(initialModes);
  const [managers, setManagers] = useState(initialManagers);
  const [code, setCode] = useState(pairCode ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `request failed (${response.status})`);
    return body;
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const refresh = async () => {
    const body = (await call("/api/profile/generation-mode", { method: "GET" })) as {
      modes: Record<Provider, Mode>;
      managers: Manager[];
    };
    setModes(body.modes);
    setManagers(body.managers);
  };

  const choose = (provider: Provider, mode: Mode) =>
    act(async () => {
      const body = (await call("/api/profile/generation-mode", {
        method: "PUT",
        body: JSON.stringify({ provider, mode }),
      })) as { modes: Record<Provider, Mode> };
      setModes(body.modes);
    });

  const approve = () =>
    act(async () => {
      await call("/api/worker/pair/approve", { method: "POST", body: JSON.stringify({ code }) });
      setCode("");
      setMessage("Paired. The Spoken Manager picks this up within a few seconds.");
      await refresh();
    });

  const unpair = (id: string) =>
    act(async () => {
      await call(`/api/profile/worker-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    });

  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-base font-semibold">Where your lines are generated</h2>
      <p className="text-muted-foreground text-sm">
        On this site, queued lines are generated here with the key you stored above. On your
        computer, the Spoken Manager generates them with a key that stays on your machine, and
        this site only keeps the audio.
      </p>

      <div className="space-y-2">
        {PROVIDERS.map((provider) => (
          <fieldset key={provider} className="flex flex-wrap items-center gap-3 text-sm" disabled={busy}>
            <legend className="sr-only">{PROVIDER_NAME[provider]}</legend>
            <span className="w-28 font-medium">{PROVIDER_NAME[provider]}</span>
            {(["site", "local"] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`mode-${provider}`}
                  checked={modes[provider] === mode}
                  onChange={() => void choose(provider, mode)}
                />
                {mode === "site" ? "On this site" : "On my computer"}
              </label>
            ))}
          </fieldset>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          No Manager?{" "}
          <Link href="/generate" className="text-foreground underline underline-offset-2">
            Generate in a browser tab
          </Link>{" "}
          instead.
        </p>
        <h3 className="text-sm font-medium">Spoken Managers</h3>
        {managers.length === 0 ? (
          <p className="text-muted-foreground text-sm">None paired yet. Open Settings in the Spoken Manager and press Pair.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {managers.map((manager) => (
              <li key={manager.id} className="flex items-center gap-3">
                <span>{manager.label}</span>
                <span className="text-muted-foreground text-xs">
                  {manager.lastUsedAt ? `last seen ${new Date(manager.lastUsedAt).toLocaleString()}` : "not seen yet"}
                </span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unpair(manager.id)}>
                  Unpair
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void approve();
          }}
        >
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Code the Manager shows, e.g. K7QM-2XPA"
            className="max-w-xs"
            aria-label="Pairing code"
          />
          <Button type="submit" size="sm" disabled={busy || code.trim().length < 8}>
            Pair
          </Button>
        </form>
        {pairCode ? (
          <p className="text-muted-foreground text-xs">
            A Spoken Manager asked to pair with this account. Pair only if the code matches the one it shows.
          </p>
        ) : null}
      </div>

      {message ? <p className="text-sm">{message}</p> : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </section>
  );
}
