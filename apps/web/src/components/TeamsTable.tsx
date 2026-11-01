"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { capabilityLabel } from "@/lib/permissions";
import type { TeamSummary } from "@/lib/teams/admin";

type Props = {
  initial: TeamSummary[];
  /** Live takes per language held, for the confirm. */
  takes: Partial<Record<Lang, number>>;
  languages: { code: Lang; name: string }[];
};

type Person = { email: string; name: string | null; held: Map<Lang, string[]> };

/** The members of a team, one entry per person with their capabilities by language. */
function people(team: TeamSummary): Person[] {
  const byUser = new Map<string, Person>();
  for (const member of team.members) {
    const person = byUser.get(member.userId) ?? { email: member.email, name: member.name, held: new Map() };
    person.held.set(member.lang, [...(person.held.get(member.lang) ?? []), capabilityLabel(member.capability)]);
    byUser.set(member.userId, person);
  }
  return [...byUser.values()];
}

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: "Could not reach the server." };
  if (response.ok) return { ok: true };
  const { error } = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: error ?? "Something went wrong." };
}

export default function TeamsTable({ initial, takes, languages }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState(() => Object.fromEntries(initial.map((team) => [team.id, team.name])));
  const [form, setForm] = useState({ slug: "", name: "", adminEmail: "", langs: [] as Lang[] });

  async function run(action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    // A partial create still changed things, so the page is refreshed either way.
    if (!result.ok) setError(result.error ?? null);
    router.refresh();
    return result.ok;
  }

  const rename = (team: TeamSummary) => {
    const name = names[team.id]?.trim();
    if (!name || name === team.name) return;
    return run(() => send(`/api/teams/${team.id}`, "PATCH", { name })).then((ok) => {
      // The refreshed team carries the new name; keeping the draft would shadow later renames.
      if (ok) setNames(({ [team.id]: _done, ...rest }) => rest);
    });
  };

  function moveTo(lang: Lang, target: TeamSummary) {
    const count = takes[lang] ?? 0;
    const sure = window.confirm(
      `Hand ${lang} to ${target.name}? ${count} live take${count === 1 ? "" : "s"} move with it, along with its voices, settings and members.`,
    );
    if (sure) void run(() => send(`/api/teams/${target.id}/languages`, "PUT", { lang }));
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await send("/api/teams", "POST", {
        slug: form.slug.trim(),
        name: form.name,
        langs: form.langs,
        ...(form.adminEmail.trim() ? { adminEmail: form.adminEmail.trim() } : {}),
      });
      if (result.ok) setForm({ slug: "", name: "", adminEmail: "", langs: [] });
      return result;
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-normal">Slug</th>
            <th className="py-2 pr-3 font-normal">Name</th>
            <th className="py-2 pr-3 font-normal">Languages</th>
            <th className="py-2 font-normal">Members</th>
          </tr>
        </thead>
        <tbody>
          {initial.map((team) => (
            <tr key={team.id} className="border-b align-top last:border-0">
              <td className="py-2 pr-3 font-mono text-xs">{team.slug}</td>
              <td className="py-2 pr-3">
                <Input
                  aria-label={`Name of ${team.slug}`}
                  value={names[team.id] ?? team.name}
                  disabled={busy}
                  onChange={(event) => setNames({ ...names, [team.id]: event.target.value })}
                  onBlur={() => rename(team)}
                  onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                />
              </td>
              <td className="py-2 pr-3">
                <ul className="flex flex-col gap-1">
                  {team.langs.map((lang) => (
                    <li key={lang} className="flex items-center gap-2">
                      <span className="w-12 font-mono text-xs">{lang}</span>
                      {lang !== BASE_LANG && (
                        <select
                          aria-label={`Move ${lang} to`}
                          className="border-input bg-background rounded-md border px-2 py-1 text-xs"
                          disabled={busy}
                          value=""
                          onChange={(event) => {
                            const target = initial.find((other) => other.id === event.target.value);
                            if (target) moveTo(lang, target);
                          }}
                        >
                          <option value="">Move to…</option>
                          {initial
                            .filter((other) => other.id !== team.id)
                            .map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </li>
                  ))}
                  {team.langs.length === 0 && <li className="text-muted-foreground text-xs">none</li>}
                </ul>
              </td>
              <td className="py-2">
                <ul className="flex flex-col gap-1">
                  {people(team).map((person) => (
                    <li key={person.email}>
                      <span>{person.name ?? person.email}</span>
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        {[...person.held].map(([lang, caps]) => `${lang}: ${caps.join(", ")}`).join("; ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={create} className="flex max-w-md flex-col gap-3">
        <h2 className="text-lg font-semibold">New team</h2>
        <Input
          aria-label="Slug"
          placeholder="slug (german)"
          value={form.slug}
          onChange={(event) => setForm({ ...form, slug: event.target.value })}
        />
        <Input
          aria-label="Name"
          placeholder="Name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <select
          multiple
          aria-label="Languages"
          className="border-input bg-background h-40 rounded-md border px-2 py-1 text-sm"
          value={form.langs}
          onChange={(event) =>
            setForm({ ...form, langs: [...event.target.selectedOptions].map((option) => option.value as Lang) })
          }
        >
          {languages.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name} ({language.code})
            </option>
          ))}
        </select>
        <Input
          aria-label="Admin email"
          type="email"
          placeholder="Admin email (optional)"
          value={form.adminEmail}
          onChange={(event) => setForm({ ...form, adminEmail: event.target.value })}
        />
        <Button type="submit" disabled={busy || !form.slug.trim() || !form.name.trim()}>
          Create team
        </Button>
      </form>
    </div>
  );
}
