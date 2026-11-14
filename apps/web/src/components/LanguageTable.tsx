"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BASE_LANG, derivedTags, type Lang } from "@/lib/lang";

type Row = { code: Lang; name: string; enabled: boolean };

/**
 * Which languages the site serves.
 *
 * Switching one on puts it in everybody's header; until then an admin can open it by its
 * address (/ptBR/quests) to see what is there, which is how a language gets prepared before
 * anybody else is shown it. English is what a bare address means and cannot be switched off.
 */
export default function LanguageTable({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState<Lang | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(code: Lang, enabled: boolean) {
    setPending(code);
    setError(null);
    const response = await fetch("/api/languages", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, enabled }),
    }).catch(() => null);
    setPending(null);
    if (!response?.ok) {
      setError(`Could not switch ${code} ${enabled ? "on" : "off"}.`);
      return;
    }
    const body = (await response.json()) as { languages: Row[] };
    setRows(body.languages);
  }

  const [form, setForm] = useState({ code: "", name: "", native: "", bcp47: "", provider: "" });
  // The tag and provider code follow the code until they are typed over: jaJP -> ja-JP, ja.
  const [touched, setTouched] = useState({ bcp47: false, provider: false });
  const [adding, setAdding] = useState(false);

  function setCode(code: string) {
    const derived = derivedTags(code);
    setForm((f) => ({
      ...f,
      code,
      bcp47: touched.bcp47 ? f.bcp47 : code.length >= 4 ? derived.bcp47 : "",
      provider: touched.provider ? f.provider : derived.provider,
    }));
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    setError(null);
    const response = await fetch("/api/languages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setAdding(false);
    if (!response?.ok) {
      const message = (await response?.json().catch(() => null))?.error as string | undefined;
      setError(message ?? `Could not add ${form.code}.`);
      return;
    }
    const body = (await response.json()) as { languages: Row[] };
    setRows(body.languages);
    setForm({ code: "", name: "", native: "", bcp47: "", provider: "" });
    setTouched({ bcp47: false, provider: false });
  }

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <label key={row.code} className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={row.enabled}
            disabled={row.code === BASE_LANG || pending === row.code}
            onCheckedChange={(checked) => toggle(row.code, checked === true)}
          />
          <span className="w-32">{row.name}</span>
          <a
            href={row.code === BASE_LANG ? "/" : `/${row.code}`}
            className="text-muted-foreground font-mono text-xs hover:underline"
          >
            {row.code}
          </a>
        </label>
      ))}
      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Add a language</span>
        <Input className="w-24" placeholder="Code (jaJP)" aria-label="Code" value={form.code} onChange={(e) => setCode(e.target.value)} />
        <Input className="w-36" placeholder="English name" aria-label="English name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input className="w-36" placeholder="Native name" aria-label="Native name" value={form.native} onChange={(e) => setForm({ ...form, native: e.target.value })} />
        <Input className="w-24" placeholder="BCP 47" aria-label="BCP 47 tag" value={form.bcp47} onChange={(e) => { setTouched((t) => ({ ...t, bcp47: true })); setForm({ ...form, bcp47: e.target.value }); }} />
        <Input className="w-20" placeholder="Provider" aria-label="Provider code" value={form.provider} onChange={(e) => { setTouched((t) => ({ ...t, provider: true })); setForm({ ...form, provider: e.target.value }); }} />
        <Button type="submit" size="sm" disabled={adding}>Add</Button>
      </form>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
