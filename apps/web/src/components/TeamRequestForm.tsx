"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import NewLanguageFields, { type NewLanguage } from "@/components/NewLanguageFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { send } from "@/lib/send";

const NEW = "__new__";

type Props = { languages: { code: string; name: string }[] };

export default function TeamRequestForm({ languages }: Props) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [fresh, setFresh] = useState<NewLanguage>({ code: "", name: "", native: "" });
  const [teamName, setTeamName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!choice) return setError("Choose a language.");
    setBusy(true);
    setError(null);
    const isNew = choice === NEW;
    const result = await send("/api/team-requests", "POST", {
      lang: isNew ? fresh.code.trim() : choice,
      ...(isNew ? { language: { name: fresh.name.trim(), native: fresh.native.trim() } } : {}),
      teamName: teamName.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setChoice("");
    setFresh({ code: "", name: "", native: "" });
    setTeamName("");
    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
      <h2 className="text-lg font-semibold">Request a team</h2>
      <select
        aria-label="Language"
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">Choose a language…</option>
        {languages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.name} ({language.code})
          </option>
        ))}
        <option value={NEW}>New language…</option>
      </select>
      {choice === NEW && <NewLanguageFields value={fresh} onChange={setFresh} />}
      <Input
        aria-label="Team name"
        placeholder="Team name"
        required
        maxLength={60}
        value={teamName}
        onChange={(event) => setTeamName(event.target.value)}
      />
      <textarea
        aria-label="Note"
        placeholder="Anything the site admins should know (optional)"
        maxLength={1000}
        className="border-input bg-background min-h-20 rounded-md border px-3 py-2 text-sm"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="self-start">
        Send request
      </Button>
    </form>
  );
}
