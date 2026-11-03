import { useState } from "react";

import type { ApiToken } from "@/lib/tokens/types";

export function useApiTokens<T extends ApiToken>(initial: T[], revokeUrl: (id: string) => string) {
  const [tokens, setTokens] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const revoke = (id: string) =>
    run(async () => {
      const response = await fetch(revokeUrl(id), { method: "DELETE" });
      if (!response.ok) throw new Error("could not revoke that token");
      const now = new Date().toISOString();
      setTokens((current) => current.map((t) => (t.id === id ? { ...t, revokedAt: now } : t)));
    });

  return { tokens, setTokens, busy, error, run, revoke };
}
