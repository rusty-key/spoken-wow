"use client";

import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { langName } from "@/lib/lang";
import { accessLabel, type ApiToken } from "@/lib/tokens/types";

import { useApiTokens } from "./useApiTokens";

/** Hints are not drawn: they are the owner's to see. */
export default function ApiTokenTable({ initial }: { initial: (ApiToken & { userEmail: string })[] }) {
  const t = useUiText();
  const words = t.apiKeys;
  const { tokens, busy, error, revoke } = useApiTokens(initial, (id) => `/api/tokens?id=${id}`);

  return (
    <section className="mt-10">
      <h2 className="mb-3 font-medium">{t.profile.tokens.title}</h2>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.profile.tokens.nobody}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">{words.owner}</th>
              <th className="py-1 font-normal">{words.label}</th>
              <th className="py-1 font-normal">{words.language}</th>
              <th className="py-1 font-normal">{words.access}</th>
              <th className="py-1 font-normal">{words.expires}</th>
              <th className="py-1 font-normal">{t.profile.tokens.lastUsed}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {tokens.map((token) => (
              <tr key={token.id}>
                <td className="py-1.5">{token.userEmail}</td>
                <td>{token.label}</td>
                <td>{token.lang ? langName(token.lang) : ""}</td>
                <td>
                  {[
                    token.lang || token.access !== "none" ? accessLabel(token) : null,
                    token.generate ? words.generate : null,
                    token.packs ? t.profile.tokens.packs : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </td>
                <td>{token.expiresAt.slice(0, 10)}</td>
                <td>{token.lastUsedAt?.slice(0, 10) ?? words.neverUsed}</td>
                <td className="text-right">
                  {token.revokedAt ? (
                    <span className="text-muted-foreground">{words.revoked}</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => revoke(token.id)}>
                      {words.revoke}
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
