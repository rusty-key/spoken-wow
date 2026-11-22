"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeclinedForms, Lang, PlayerForms, PlayerWords } from "@/lib/lang";
import { withLang } from "@/lib/lang";
import { PLAYER_WORD_LIMIT } from "@/lib/player-words";
import { send } from "@/lib/send";

type Reader = "m" | "f";
type Field = "name" | "race" | "nameGenitive" | "classPlural";
type CaseRow = { n: string; name: string; race: string };
type Draft = Record<Reader, Record<Field, string> & { cases: CaseRow[] }> & { quantity: string };

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

function draftForms(forms: PlayerForms | undefined): Draft[Reader] {
  return {
    name: forms?.name ?? "",
    race: forms?.race ?? "",
    nameGenitive: forms?.nameGenitive ?? "",
    classPlural: forms?.classPlural ?? "",
    cases: Object.entries(forms?.cases ?? {}).map(([n, declined]) => ({
      n,
      name: declined.name ?? "",
      race: declined.race ?? "",
    })),
  };
}

function draftOf(words: PlayerWords | null): Draft {
  return { m: draftForms(words?.m), f: draftForms(words?.f), quantity: words?.quantity ?? "" };
}

function formsOf(draft: Draft[Reader]): PlayerForms {
  const { cases: rows, ...words } = draft;
  const cases: DeclinedForms = {};
  for (const row of rows) {
    if (row.n.trim()) cases[row.n.trim()] = { name: row.name, race: row.race };
  }
  return { ...words, cases };
}

/** A language's player words, for its text maintainers: what every recording says for the reader. */
export default function PlayerWordsEditor({
  lang,
  initial,
  defaults,
  saved: hasRow,
}: {
  lang: Lang;
  initial: PlayerWords | null;
  /** Spoken's own words for the language, which Reset returns to. */
  defaults: PlayerWords | null;
  /** Whether the language's row holds words, so Remove or Reset has something to clear. */
  saved: boolean;
}) {
  const router = useRouter();
  const [words, setWords] = useState<Draft>(() => draftOf(initial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (change: (was: Draft) => Draft) => {
    setSaved(false);
    setWords(change);
  };
  const updateCases = (reader: Reader, change: (rows: CaseRow[]) => CaseRow[]) =>
    update((was) => ({ ...was, [reader]: { ...was[reader], cases: change(was[reader].cases) } }));

  async function save(next: Draft | null) {
    setBusy(true);
    setError(null);
    const body = next && { m: formsOf(next.m), f: formsOf(next.f), quantity: next.quantity };
    const result = await send(withLang(lang, "/api/languages/player-words"), "PUT", { words: body });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (!next) setWords(draftOf(defaults));
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save(words);
      }}
    >
      {READERS.map((reader) => (
        <fieldset key={reader.key} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{reader.label}</legend>
          {FIELDS.map((field) => (
            <WordRow
              key={field.key}
              label={field.label}
              hint={field.hint}
              required={field.required}
              value={words[reader.key][field.key]}
              onChange={(value) =>
                update((was) => ({ ...was, [reader.key]: { ...was[reader.key], [field.key]: value } }))
              }
            />
          ))}
          <CaseRows
            rows={words[reader.key].cases}
            onChange={(change) => updateCases(reader.key, change)}
          />
        </fieldset>
      ))}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Every reader</legend>
        <WordRow
          label="A writ's count ($2oa)"
          hint="Optional: an order of"
          required={false}
          value={words.quantity}
          onChange={(value) => update((was) => ({ ...was, quantity: value }))}
        />
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
        {hasRow && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => save(null)}>
            {defaults ? "Reset" : "Remove"}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Declined forms: the word a `|3-N($c)` or `|3-N($r)` says, by its case number N. */
function CaseRows({
  rows,
  onChange,
}: {
  rows: CaseRow[];
  onChange: (change: (rows: CaseRow[]) => CaseRow[]) => void;
}) {
  const set = (at: number, change: Partial<CaseRow>) =>
    onChange((was) => was.map((row, index) => (index === at ? { ...row, ...change } : row)));
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span>Declined forms (|3-N)</span>
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[4rem_1fr_1fr_auto] items-center gap-2">
          <Input
            aria-label="Case"
            required
            inputMode="numeric"
            pattern="[1-9]"
            maxLength={1}
            placeholder="6"
            value={row.n}
            onChange={(event) => set(index, { n: event.target.value })}
          />
          <Input
            aria-label="Name and class in this case"
            maxLength={PLAYER_WORD_LIMIT}
            placeholder="$N, $C"
            value={row.name}
            onChange={(event) => set(index, { name: event.target.value })}
          />
          <Input
            aria-label="Race in this case"
            maxLength={PLAYER_WORD_LIMIT}
            placeholder="$R"
            value={row.race}
            onChange={(event) => set(index, { race: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange((was) => was.filter((_, at) => at !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange((was) => [...was, { n: "", name: "", race: "" }])}>
          Add a case
        </Button>
      </div>
    </div>
  );
}

function WordRow(props: {
  label: string;
  hint: string;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[14rem_1fr] items-center gap-3 text-sm">
      <span>{props.label}</span>
      <Input
        required={props.required}
        maxLength={PLAYER_WORD_LIMIT}
        placeholder={props.hint}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
