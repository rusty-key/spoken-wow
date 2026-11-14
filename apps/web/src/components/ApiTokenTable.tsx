"use client";

import { Button } from "@/components/ui/button";
import { langName } from "@/lib/lang";
import type { ApiToken } from "@/lib/tokens/types";

import { useApiTokens } from "./useApiTokens";

/** Hints are not drawn: they are the owner's to see. */
export default function ApiTokenTable({ initial }: { initial: (ApiToken & { userEmail: string })[] }) {
  const { tokens, busy, error, revoke } = useApiTokens(initial, (id) => `/api/tokens?id=${id}`);

  return (
    <section className="mt-10">
      <h2 className="mb-3 font-medium">API tokens</h2>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody has made one yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Owner</th>
              <th className="py-1 font-normal">Label</th>
              <th className="py-1 font-normal">Language</th>
              <th className="py-1 font-normal">Access</th>
              <th className="py-1 font-normal">Expires</th>
              <th className="py-1 font-normal">Last used</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {tokens.map((token) => (
              <tr key={token.id}>
                <td className="py-1.5">{token.userEmail}</td>
                <td>{token.label}</td>
                <td>{langName(token.lang)}</td>
                <td>{token.access === "none" ? "no text" : token.access}{token.generate ? ", generate" : ""}</td>
                <td>{token.expiresAt.slice(0, 10)}</td>
                <td>{token.lastUsedAt?.slice(0, 10) ?? "never"}</td>
                <td className="text-right">
                  {token.revokedAt ? (
                    <span className="text-muted-foreground">revoked</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => revoke(token.id)}>
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
