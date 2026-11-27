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
import DeleteTeamDialog from "@/components/DeleteTeamDialog";
import NewLanguageFields, { type NewLanguage } from "@/components/NewLanguageFields";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUiText } from "@/components/UiTextProvider";
import { type Lang } from "@/lib/lang";
import { send } from "@/lib/send";
import { fill } from "@/lib/site-text/format";
import type { TeamSummary } from "@/lib/teams/admin";
import { BASE_TEAM_SLUG } from "@/lib/teams/slug";
import type { UiText } from "@/lib/ui-text/en";

type Props = {
  initial: TeamSummary[];
  languages: { code: Lang; name: string }[];
};

type Person = { email: string; name: string | null; held: Map<Lang, string[]> };

function people(team: TeamSummary, label: (capability: string) => string): Person[] {
  const byUser = new Map<string, Person>();
  for (const member of team.members) {
    const person = byUser.get(member.userId) ?? { email: member.email, name: member.name, held: new Map() };
    person.held.set(member.lang, [...(person.held.get(member.lang) ?? []), label(member.capability)]);
    byUser.set(member.userId, person);
  }
  return [...byUser.values()];
}


/** Where a deletion is: its delistings, or why it stopped. */
function deletingStep(deleting: NonNullable<TeamSummary["deleting"]>, words: UiText["teams"]): string {
  if (deleting.error) return fill(words.deletingStopped, { error: deleting.error });
  if (deleting.delists === 0) return words.deleting;
  return fill(words.deletingStep, { done: deleting.delisted, all: deleting.delists });
}

// How often the page reads again while a team is being deleted.
const DELETING_POLL_MS = 10_000;

export default function TeamsTable({ initial, languages }: Props) {
  const t = useUiText();
  const words = t.teams;
  const capability = (cap: string) => t.dashboard.capabilities[cap as keyof typeof t.dashboard.capabilities];
  const router = useRouter();
  const nameOf = (lang: Lang) => languages.find((language) => language.code === lang)?.name ?? lang;
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
  const [joining, setJoining] = useState<{ lang: Lang; team: TeamSummary } | null>(null);
  const [deleting, setDeleting] = useState<TeamSummary | null>(null);
  const underway = initial.some((team) => team.deleting && !team.deleting.error);
  useEffect(() => {
    if (!underway) return;
    // A hidden tab reads nothing; the next poll after it shows again does.
    const timer = setInterval(() => document.hidden || router.refresh(), DELETING_POLL_MS);
    return () => clearInterval(timer);
  }, [underway, router]);

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

  function join() {
    if (!joining) return;
    const { lang, team } = joining;
    setJoining(null);
    void run(() => send(`/api/teams/${team.id}/languages`, "PUT", { lang }));
  }


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
            <th className="py-2 pr-3 font-normal">{words.slug}</th>
            <th className="py-2 pr-3 font-normal">{words.name}</th>
            <th className="py-2 pr-3 font-normal">{words.languages}</th>
            <th className="py-2 pr-3 font-normal">{words.members}</th>
            <th className="py-2 pr-3 font-normal" title={words.ownStorageHint}>
              {words.ownStorage}
            </th>
            <th className="py-2 pr-3 font-normal" title={words.officialHint}>
              {words.official}
            </th>
            <th className="py-2 font-normal">
              <span className="sr-only">{words.delete}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {initial.map((team) => (
            <tr key={team.id} className="border-b align-top last:border-0">
              <td className="py-2 pr-3 font-mono text-xs">{team.slug}</td>
              <td className="py-2 pr-3">
                <Input
                  aria-label={fill(words.nameOf, { slug: team.slug })}
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
                  {team.langs.length === 0 && <li className="text-muted-foreground text-xs">{words.none}</li>}
                  <li>
                    <Select
                      value=""
                      disabled={busy}
                      onValueChange={(lang) => setJoining({ lang: lang as Lang, team })}
                    >
                      <SelectTrigger size="sm" className="text-xs" aria-label={fill(words.addToLanguage, { slug: team.slug })}>
                        <SelectValue placeholder={words.addTo} />
                      </SelectTrigger>
                      <SelectContent>
                        {languages
                          .filter((language) => !team.langs.includes(language.code))
                          .map((language) => (
                            <SelectItem key={language.code} value={language.code}>
                              {language.name} ({language.code})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </li>
                </ul>
              </td>
              <td className="py-2 pr-3">
                <ul className="flex flex-col gap-1">
                  {people(team, capability).map((person) => (
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
                  aria-label={fill(words.storageFor, { slug: team.slug })}
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
                  aria-label={fill(words.officialFor, { slug: team.slug })}
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
                {team.deleting ? (
                  <div className="flex flex-col items-end gap-1">
                    <span className={team.deleting.error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                      {deletingStep(team.deleting, words)}
                    </span>
                    {team.deleting.error && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={fill(words.retryFor, { slug: team.slug })}
                        disabled={busy}
                        onClick={() => void run(() => send(`/api/teams/${team.id}/deletion`, "POST"))}
                      >
                        {words.retry}
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={fill(words.deleteFor, { slug: team.slug })}
                    title={team.slug === BASE_TEAM_SLUG ? words.englishCannotBeDeleted : undefined}
                    disabled={busy || team.slug === BASE_TEAM_SLUG}
                    onClick={() => setDeleting(team)}
                  >
                    {words.delete}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={create} className="flex max-w-md flex-col gap-3">
        <h2 className="text-lg font-semibold">{words.newTeam}</h2>
        <Input
          aria-label={words.slug}
          placeholder={words.slugPlaceholder}
          value={form.slug}
          onChange={(event) => setForm({ ...form, slug: event.target.value })}
        />
        <Input
          aria-label={words.name}
          placeholder={words.name}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <select
          multiple
          aria-label={words.languages}
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
          {words.newLanguageOption}
        </label>
        {newLanguage && <NewLanguageFields value={fresh} onChange={setFresh} />}
        <Input
          aria-label={words.adminEmail}
          type="email"
          placeholder={words.adminEmailPlaceholder}
          value={form.adminEmail}
          onChange={(event) => setForm({ ...form, adminEmail: event.target.value })}
        />
        <Button type="submit" disabled={busy || !form.slug.trim() || !form.name.trim()}>
          {words.createTeam}
        </Button>
      </form>

      <DeleteTeamDialog
        team={deleting}
        nameOf={nameOf}
        onClose={() => setDeleting(null)}
        onSent={(refused) => {
          setDeleting(null);
          setError(refused);
          router.refresh();
        }}
      />

      <Dialog open={joining !== null} onOpenChange={(open) => !open && setJoining(null)}>
        {joining && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{fill(words.addToTitle, { team: joining.team.name, lang: joining.lang })}</DialogTitle>
              <DialogDescription>
                {fill(words.addToBody, { lang: joining.lang })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setJoining(null)}>
                {words.cancel}
              </Button>
              <Button onClick={join}>{words.add}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
