"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ApiKeyStatus } from "@/lib/api-key";

/**
 * Saving and removing one stored credential on /profile. `noun` is what its errors call it.
 *
 * The plaintext stays with the caller's inputs: nothing here reads a credential back, so there
 * is no reveal control and no round trip that could carry one.
 */
export function useStoredCredential(initial: ApiKeyStatus | null, endpoint: string, noun: string) {
  // Re-rendered from the server after a save or a removal, because other sections of the page
  // depend on which keys exist: the generator choice offers a provider only once it has one.
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  // Replacing is a separate state from having none, so a set key cannot be overwritten by a
  // stray paste into a field that was sitting there open.
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Whether it was stored, so the caller knows to empty its inputs. */
  async function save(body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = (await response.json()) as { status?: ApiKeyStatus; error?: string };
      if (!response.ok || !answer.status) throw new Error(answer.error ?? `could not save that ${noun}`);
      setStatus(answer.status);
      setReplacing(false);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error(`could not remove that ${noun}`);
      setStatus(null);
      setReplacing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return { status, replacing, setReplacing, busy, error, setError, save, remove };
}
