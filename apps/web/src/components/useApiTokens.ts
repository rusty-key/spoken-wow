import { useState } from "react";

import type { ApiToken } from "@/lib/tokens/types";

export function useApiTokens<T extends ApiToken>(initial: T[], revokeUrl: (id: string) => string) {
  const [tokens, setTokens] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(revokeUrl(id), { method: "DELETE" });
      if (!response.ok) throw new Error("could not revoke that token");
      const now = new Date().toISOString();
      setTokens((current) => current.map((t) => (t.id === id ? { ...t, revokedAt: now } : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return { tokens, setTokens, busy, setBusy, error, setError, revoke };
}
