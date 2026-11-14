"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { langName, type Lang } from "@/lib/lang";
import type { ApiToken, TokenAccess } from "@/lib/tokens/types";

import { useApiTokens } from "./useApiTokens";

const DAY_MS = 86_400_000;

function dateInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

export type TokenLang = { lang: Lang; text: boolean; generate: boolean };

const SELECT = "border-input bg-background h-9 rounded-md border px-2 text-sm";

/**
 * A maintainer's API tokens. A new token is drawn once, from the response that made it,
 * and leaving the page loses it: nothing can read it back.
 */
export default function ApiTokenSection({ langs, initial }: { langs: TokenLang[]; initial: ApiToken[] }) {
  const { tokens, setTokens, busy, error, run, revoke } = useApiTokens(
    initial,
    (id) => `/api/profile/tokens/${id}`,
  );
  const [label, setLabel] = useState("");
  const [lang, setLang] = useState<Lang>(langs[0].lang);
  const [access, setAccess] = useState<TokenAccess>(langs[0].text ? "read" : "none");
  const [generate, setGenerate] = useState(!langs[0].text && langs[0].generate);
  const [expires, setExpires] = useState(() => dateInDays(90));
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const chosen = langs.find((entry) => entry.lang === lang) ?? langs[0];

  // Switching language drops a choice the owner cannot make there and restores the one that
  // was dropped: Read when text is back, generate on when it is all they can do.
  function chooseLang(code: Lang) {
    const next = langs.find((entry) => entry.lang === code) ?? langs[0];
    setLang(code);
    if (!next.text) setAccess("none");
    else if (access === "none") setAccess("read");
    if (!next.generate) setGenerate(false);
    else if (!next.text) setGenerate(true);
  }

  const create = () =>
    run(async () => {
      setCopied(false);
      const response = await fetch("/api/profile/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The end of the chosen day, so a token set to expire today is not already dead.
        body: JSON.stringify({ label, lang, access, generate, expiresAt: `${expires}T23:59:59Z` }),
      });
      const body = (await response.json()) as { token?: string; row?: ApiToken; error?: string };
      if (!response.ok || !body.token || !body.row) throw new Error(body.error ?? "could not create that token");
      setCreated(body.token);
      setTokens((current) => [body.row!, ...current]);
      setLabel("");
    });

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created);
    setCopied(true);
  }

  return (
    <section id="api-tokens" className="mt-10 max-w-2xl scroll-mt-20">
      <h2 className="mb-1 font-medium">API tokens</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Lets a script or an agent read or change text in one language on your behalf. Point it at{" "}
        <code>/api/v1</code>. Writes go live at once, under your name. A token stops working at its
        expiry, when revoked, or when you stop being a text maintainer in its language. A generate
        token also queues audio, which spends your own ElevenLabs or fish.audio key, and stops
        working when you lose the right to regenerate in its language.
      </p>

      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      {created && (
        <div className="mb-4 rounded border p-3 text-sm">
          <p className="mb-2 font-medium">Copy this token now. It will not be shown again.</p>
          <code className="bg-muted mb-2 block break-all rounded px-2 py-1">{created}</code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          Label
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="German agent" className="w-44" />
        </label>
        <label className="flex flex-col gap-1">
          Language
          <select value={lang} onChange={(e) => chooseLang(e.target.value as Lang)} className={SELECT}>
            {langs.map(({ lang: code }) => (
              <option key={code} value={code}>
                {langName(code)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Access
          <select value={access} onChange={(e) => setAccess(e.target.value as TokenAccess)} className={SELECT}>
            <option value="none">No text</option>
            {chosen.text && <option value="read">Read</option>}
            {chosen.text && <option value="write">Read and write</option>}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={generate}
            disabled={!chosen.generate}
            onChange={(e) => setGenerate(e.target.checked)}
          />
          Generate audio on my key
        </label>
        <label className="flex flex-col gap-1">
          Expires
          <Input
            type="date"
            required
            min={dateInDays(0)}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="w-40"
          />
        </label>
        <Button onClick={create} disabled={busy || !label.trim() || !expires || (access === "none" && !generate)}>
          Create token
        </Button>
      </div>

      {tokens.length > 0 && (
        <ul className="divide-y text-sm">
          {tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="font-medium">{token.label}</span>
              <span className="text-muted-foreground font-mono">…{token.hint}</span>
              <span>{langName(token.lang)}</span>
              <span>{token.access === "none" ? "no text" : token.access}</span>
              {token.generate && <span>generate</span>}
              <span className="text-muted-foreground">expires {token.expiresAt.slice(0, 10)}</span>
              <span className="text-muted-foreground">
                {token.lastUsedAt ? `last used ${token.lastUsedAt.slice(0, 10)}` : "never used"}
              </span>
              {token.revokedAt ? (
                <span className="text-muted-foreground ml-auto">revoked</span>
              ) : (
                <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => revoke(token.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
