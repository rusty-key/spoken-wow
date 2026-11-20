"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import NewLanguageFields, { type NewLanguage } from "@/components/NewLanguageFields";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { capabilityLabel } from "@/lib/permissions";
import { send } from "@/lib/send";
import type { TeamSummary } from "@/lib/teams/admin";

type Props = {
  initial: TeamSummary[];
  languages: { code: Lang; name: string }[];
};

type Person = { email: string; name: string | null; held: Map<Lang, string[]> };

function people(team: TeamSummary): Person[] {
  const byUser = new Map<string, Person>();
  for (const member of team.members) {
    const person = byUser.get(member.userId) ?? { email: member.email, name: member.name, held: new Map() };
    person.held.set(member.lang, [...(person.held.get(member.lang) ?? []), capabilityLabel(member.capability)]);
    byUser.set(member.userId, person);
  }
  return [...byUser.values()];
}

type Confirm = { title: string; description: string; label: string; destructive?: boolean; action: () => ReturnType<typeof send> };

export default function TeamsTable({ initial, languages }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState(() => Object.fromEntries(initial.map((team) => [team.id, team.name])));
  const [ownStorage, setOwnStorage] = useState<Record<string, boolean>>({});
  const [official, setOfficial] = useState<Record<string, boolean>>({});
  // A saved value shows only until the refresh after the save lands. That refresh read the team
  // after the save, so its value is the one to show, even one another owner saved since.
  useEffect(() => {
    setOwnStorage({});
    setOfficial({});
  }, [initial]);
  const [form, setForm] = useState({ slug: "", name: "", adminEmail: "", langs: [] as Lang[] });
  const [newLanguage, setNewLanguage] = useState(false);
  const [fresh, setFresh] = useState<NewLanguage>({ code: "", name: "", native: "" });
  const [confirming, setConfirming] = useState<Confirm | null>(null);

  async function run(action: () => ReturnType<typeof send>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    // A partial create still changed things, so the page is refreshed either way.
    if (!result.ok) setError(result.error);
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

  function confirm() {
    if (!confirming) return;
    setConfirming(null);
    void run(confirming.action);
  }

  const join = (lang: Lang, team: TeamSummary) =>
    setConfirming({
      title: `Add ${team.name} to ${lang}?`,
      description: `It voices ${lang} beside any team there, from English's voices, with nothing of theirs. A language with no team is switched on.`,
      label: "Add",
      action: () => send(`/api/teams/${team.id}/languages`, "PUT", { lang }),
    });

  const remove = (team: TeamSummary) =>
    setConfirming({
      title: `Delete ${team.name}?`,
      description: `Its voices, settings, lexicon, members and invites go with it. A team with takes, recordings or other work of its own is refused.`,
      label: "Delete team",
      destructive: true,
      action: () => send(`/api/teams/${team.id}`, "DELETE"),
    });

  async function create(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await send("/api/teams", "POST", {
        slug: form.slug.trim(),
        name: form.name,
        ...(newLanguage
          ? { newLanguage: { code: fresh.code.trim(), name: fresh.name.trim(), native: fresh.native.trim() } }
          : { langs: form.langs }),
        ...(form.adminEmail.trim() ? { adminEmail: form.adminEmail.trim() } : {}),
      });
      if (result.ok) {
        setForm({ slug: "", name: "", adminEmail: "", langs: [] });
        setFresh({ code: "", name: "", native: "" });
        setNewLanguage(false);
      }
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
            <th className="py-2 pr-3 font-normal">Members</th>
            <th className="py-2 pr-3 font-normal" title="New audio goes only to its own bucket; what is already in Spoken's archive stays">
              Own storage
            </th>
            <th className="py-2 pr-3 font-normal" title="Its releases need no review, and its packs carry no team name in the Manager">
              Official
            </th>
            <th className="py-2 font-normal">
              <span className="sr-only">Delete</span>
            </th>
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
                    <li key={lang} className="font-mono text-xs">
                      {lang}
                    </li>
                  ))}
                  {team.langs.length === 0 && <li className="text-muted-foreground text-xs">none</li>}
                  {!team.langs.includes(BASE_LANG) && (
                    <li>
                      <Select
                        value=""
                        disabled={busy}
                        onValueChange={(lang) => join(lang as Lang, team)}
                      >
                        <SelectTrigger size="sm" className="text-xs" aria-label={`Add ${team.slug} to a language`}>
                          <SelectValue placeholder="Add to…" />
                        </SelectTrigger>
                        <SelectContent>
                          {languages
                            .filter((language) => language.code !== BASE_LANG && !team.langs.includes(language.code))
                            .map((language) => (
                              <SelectItem key={language.code} value={language.code}>
                                {language.name} ({language.code})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </li>
                  )}
                </ul>
              </td>
              <td className="py-2 pr-3">
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
              <td className="py-2 pr-3">
                <input
                  type="checkbox"
                  aria-label={`${team.slug}'s new audio goes only to its own bucket`}
                  checked={ownStorage[team.id] ?? team.ownStorage}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.checked;
                    void run(() => send(`/api/teams/${team.id}`, "PATCH", { ownStorage: next })).then((ok) => {
                      if (ok) setOwnStorage((current) => ({ ...current, [team.id]: next }));
                    });
                  }}
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  type="checkbox"
                  aria-label={`${team.slug} is official`}
                  checked={official[team.id] ?? team.official}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.checked;
                    void run(() => send(`/api/teams/${team.id}`, "PATCH", { official: next })).then((ok) => {
                      if (ok) setOfficial((current) => ({ ...current, [team.id]: next }));
                    });
                  }}
                />
              </td>
              <td className="py-2 pl-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${team.slug}`}
                  disabled={busy}
                  onClick={() => remove(team)}
                >
                  Delete
                </Button>
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
          disabled={newLanguage}
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={newLanguage} onChange={(event) => setNewLanguage(event.target.checked)} />
          New language…
        </label>
        {newLanguage && <NewLanguageFields value={fresh} onChange={setFresh} />}
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

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        {confirming && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirming.title}</DialogTitle>
              <DialogDescription>{confirming.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button variant={confirming.destructive ? "destructive" : "default"} onClick={confirm}>
                {confirming.label}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
