"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Lang, PlayerForms, PlayerWords } from "@/lib/lang";
import { withLang } from "@/lib/lang";
import { PLAYER_WORD_LIMIT } from "@/lib/player-words";
import { send } from "@/lib/send";

type Reader = "m" | "f";
type Field = keyof PlayerForms;

const EMPTY: PlayerForms = { name: "", race: "", nameGenitive: "", classPlural: "" };

const FIELDS: { key: Field; label: string; hint: string; required: boolean }[] = [
  { key: "name", label: "Name and class ($N, $C)", hint: "adventurer", required: true },
  { key: "race", label: "Race ($R)", hint: "traveler", required: true },
  { key: "nameGenitive", label: "Name with a glued s ($Ns)", hint: "Optional: German's Abenteurers", required: false },
  { key: "classPlural", label: "Class plural ($cs)", hint: "Optional: French's aventuriers", required: false },
];

const READERS: { key: Reader; label: string }[] = [
  { key: "m", label: "Male reader, and every line that does not branch" },
  { key: "f", label: "Female reader" },
];

/** A language's player words, for its text maintainers: what every recording says for the reader. */
export default function PlayerWordsEditor({ lang, initial }: { lang: Lang; initial: PlayerWords | null }) {
  const router = useRouter();
  const [words, setWords] = useState<Record<Reader, PlayerForms>>({
    m: { ...EMPTY, ...initial?.m },
    f: { ...EMPTY, ...initial?.f },
  });
  const [quantity, setQuantity] = useState(initial?.quantity ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (reader: Reader, field: Field, value: string) => {
    setSaved(false);
    setWords((was) => ({ ...was, [reader]: { ...was[reader], [field]: value } }));
  };

  async function save(next: PlayerWords | null) {
    setBusy(true);
    setError(null);
    const result = await send(withLang(lang, "/api/languages/player-words"), "PUT", { words: next });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (!next) {
      setWords({ m: { ...EMPTY }, f: { ...EMPTY } });
      setQuantity("");
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save({ ...words, quantity });
      }}
    >
      {READERS.map((reader) => (
        <fieldset key={reader.key} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{reader.label}</legend>
          {FIELDS.map((field) => (
            <label key={field.key} className="grid grid-cols-[14rem_1fr] items-center gap-3 text-sm">
              <span>{field.label}</span>
              <Input
                required={field.required}
                maxLength={PLAYER_WORD_LIMIT}
                placeholder={field.hint}
                value={words[reader.key][field.key] ?? ""}
                onChange={(event) => set(reader.key, field.key, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Every reader</legend>
        <label className="grid grid-cols-[14rem_1fr] items-center gap-3 text-sm">
          <span>A writ&apos;s count ($2oa)</span>
          <Input
            maxLength={PLAYER_WORD_LIMIT}
            placeholder="Optional: an order of"
            value={quantity}
            onChange={(event) => {
              setSaved(false);
              setQuantity(event.target.value);
            }}
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {saved && <p className="text-muted-foreground text-sm">Saved. Takes whose lines say these words are now stale.</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        {initial && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => save(null)}>
            Remove
          </Button>
        )}
      </div>
    </form>
  );
}
