"use client";

import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { langName, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { needsLang as langNeeded, scopeLabels, type ApiToken, type TokenAccess } from "@/lib/tokens/types";

import { useApiTokens } from "./useApiTokens";

const DAY_MS = 86_400_000;

function dateInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** A language where the person holds `text` or `regenerate`, either of which backs text access. */
export type TokenLang = { lang: Lang; generate: boolean };

const SELECT = "border-input bg-background h-9 rounded-md border px-2 text-sm";

/**
 * A member's API tokens. A new token is drawn once, from the response that made it, and leaving
 * the page loses it: nothing can read it back. `langs` is empty for a member with no text or
 * regenerate grant, who can still make a community packs token.
 */
export default function ApiTokenSection({ langs, initial }: { langs: TokenLang[]; initial: ApiToken[] }) {
  const { tokens, setTokens, busy, error, run, revoke } = useApiTokens(
    initial,
    (id) => `/api/profile/tokens/${id}`,
  );
  const t = useUiText();
  const words = t.apiKeys;
  const [label, setLabel] = useState("");
  const [lang, setLang] = useState<Lang | null>(langs[0]?.lang ?? null);
  const [access, setAccess] = useState<TokenAccess>(langs.length ? "read" : "none");
  const [generate, setGenerate] = useState(false);
  const [packs, setPacks] = useState(!langs.length);
  const [expires, setExpires] = useState(() => dateInDays(90));
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const chosen = langs.find((entry) => entry.lang === lang) ?? langs[0];
  const needsLang = langNeeded({ access, generate });

  function chooseLang(code: Lang) {
    const next = langs.find((entry) => entry.lang === code) ?? langs[0];
    setLang(code);
    if (!next.generate) setGenerate(false);
    // With generate gone, "No text" would leave nothing to create.
    if (!next.generate && access === "none" && !packs) setAccess("read");
  }

  const create = () =>
    run(async () => {
      setCopied(false);
      const response = await fetch("/api/profile/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The end of the chosen day, so a token set to expire today is not already dead.
        body: JSON.stringify({
          label,
          lang: needsLang ? lang : null,
          access,
          generate,
          packs,
          expiresAt: `${expires}T23:59:59Z`,
        }),
      });
      const body = (await response.json()) as { token?: string; row?: ApiToken; error?: string };
      if (!response.ok || !body.token || !body.row) throw new Error(body.error ?? words.couldNotCreate);
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
      <h2 className="mb-1 font-medium">{t.profile.tokens.title}</h2>
      {chosen && (
        <p className="text-muted-foreground mb-4 text-sm">
          {words.aboutBefore}
          <code>/api/v1</code>
          {words.aboutAfter}
        </p>
      )}
      <p className="text-muted-foreground mb-4 text-sm">{t.profile.tokens.packsAbout}</p>

      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      {created && (
        <div className="mb-4 rounded border p-3 text-sm">
          <p className="mb-2 font-medium">{t.profile.tokens.copied}</p>
          <code className="bg-muted mb-2 block break-all rounded px-2 py-1">{created}</code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? words.copied : words.copy}
          </Button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          {words.label}
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={words.labelPlaceholder} className="w-44" />
        </label>
        {chosen && (
          <>
            <label className="flex flex-col gap-1">
              {words.language}
              <select
                value={chosen.lang}
                disabled={!needsLang}
                onChange={(e) => chooseLang(e.target.value as Lang)}
                className={SELECT}
              >
                {langs.map(({ lang: code }) => (
                  <option key={code} value={code}>
                    {langName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {words.access}
              <select value={access} onChange={(e) => setAccess(e.target.value as TokenAccess)} className={SELECT}>
                <option value="none">{words.noText}</option>
                <option value="read">{words.read}</option>
                <option value="write">{t.profile.tokens.readWrite}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={generate}
                disabled={!chosen.generate}
                onChange={(e) => setGenerate(e.target.checked)}
              />
              {t.profile.tokens.generateOnMyKey}
            </label>
          </>
        )}
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" checked={packs} onChange={(e) => setPacks(e.target.checked)} />
          {t.profile.tokens.packs}
        </label>
        <label className="flex flex-col gap-1">
          {words.expires}
          <Input
            type="date"
            required
            min={dateInDays(0)}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="w-40"
          />
        </label>
        <Button onClick={create} disabled={busy || !label.trim() || !expires || (!needsLang && !packs)}>
          {t.profile.tokens.create}
        </Button>
      </div>

      {tokens.length > 0 && (
        <ul className="divide-y text-sm">
          {tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="font-medium">{token.label}</span>
              <span className="text-muted-foreground font-mono">…{token.hint}</span>
              {token.lang && <span>{langName(token.lang)}</span>}
              {scopeLabels(token, { generate: words.generate, packs: t.profile.tokens.packs }).map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
              <span className="text-muted-foreground">{fill(words.expiresOn, { when: token.expiresAt.slice(0, 10) })}</span>
              <span className="text-muted-foreground">
                {token.lastUsedAt ? fill(words.lastUsedOn, { when: token.lastUsedAt.slice(0, 10) }) : words.neverUsed}
              </span>
              {token.revokedAt ? (
                <span className="text-muted-foreground ml-auto">{words.revoked}</span>
              ) : (
                <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => revoke(token.id)}>
                  {words.revoke}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
