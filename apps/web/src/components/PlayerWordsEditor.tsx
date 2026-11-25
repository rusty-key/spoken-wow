"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeclinedForms, Lang, PlayerForms, PlayerWords } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { withLang } from "@/lib/lang";
import { PLAYER_WORD_LIMIT } from "@/lib/player-words";
import { send } from "@/lib/send";

type Reader = "m" | "f";
type Field = "name" | "race" | "nameGenitive" | "classPlural" | "raceWeak";
type Declined = Required<DeclinedForms[string]>;
/** One case number for both readers, so a case cannot be given to one and forgotten for the other. */
type CaseRow = { n: string } & Record<Reader, Declined>;
type Draft = Record<Reader, Record<Field, string>> & { cases: CaseRow[]; quantity: string };

const FIELDS: { key: Field; required: boolean }[] = [
  { key: "name", required: true },
  { key: "race", required: true },
  { key: "nameGenitive", required: false },
  { key: "classPlural", required: false },
  { key: "raceWeak", required: false },
];

const DECLINED: { key: keyof Declined; label: string }[] = [
  { key: "name", label: "$N, $C" },
  { key: "race", label: "$R" },
];

const READERS: { key: Reader; other: Reader }[] = [
  { key: "m", other: "f" },
  { key: "f", other: "m" },
];

function draftFields(forms: PlayerForms | undefined): Record<Field, string> {
  return Object.fromEntries(FIELDS.map(({ key }) => [key, forms?.[key] ?? ""])) as Record<Field, string>;
}

function draftCases(words: PlayerWords | null): CaseRow[] {
  const numbers = new Set([...Object.keys(words?.m.cases ?? {}), ...Object.keys(words?.f.cases ?? {})]);
  const declined = (reader: Reader, n: string): Declined => {
    const forms = words?.[reader].cases?.[n];
    return { name: forms?.name ?? "", race: forms?.race ?? "" };
  };
  return [...numbers].sort().map((n) => ({ n, m: declined("m", n), f: declined("f", n) }));
}

function draftOf(words: PlayerWords | null): Draft {
  return {
    m: draftFields(words?.m),
    f: draftFields(words?.f),
    cases: draftCases(words),
    quantity: words?.quantity ?? "",
  };
}

function formsOf(draft: Draft, reader: Reader): PlayerForms {
  const cases: DeclinedForms = {};
  for (const row of draft.cases) {
    if (row.n.trim()) cases[row.n.trim()] = row[reader];
  }
  return { ...draft[reader], cases };
}

/** A case number on two rows: words are stored by number, so the second would silently replace the first. */
function repeatedCase(cases: CaseRow[]): string | undefined {
  const numbers = cases.map((row) => row.n.trim());
  return numbers.find((n, at) => n && numbers.indexOf(n) !== at);
}

const emptyCase = (): CaseRow => ({ n: "", m: { name: "", race: "" }, f: { name: "", race: "" } });

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
  const t = useUiText().playerWords;
  const router = useRouter();
  const [words, setWords] = useState<Draft>(() => draftOf(initial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (change: (was: Draft) => Draft) => {
    setSaved(false);
    setWords(change);
  };
  const setWord = (reader: Reader, field: Field, value: string) =>
    update((was) => ({ ...was, [reader]: { ...was[reader], [field]: value } }));
  const updateCases = (change: (cases: CaseRow[]) => CaseRow[]) =>
    update((was) => ({ ...was, cases: change(was.cases) }));
  const patchCase = (at: number, patch: (row: CaseRow) => Partial<CaseRow>) =>
    updateCases((cases) => cases.map((row, index) => (index === at ? { ...row, ...patch(row) } : row)));

  async function save(next: Draft | null) {
    const twice = next && repeatedCase(next.cases);
    if (twice) return setError(`Case ${twice} is listed twice.`);
    setBusy(true);
    setError(null);
    const body = next && { m: formsOf(next, "m"), f: formsOf(next, "f"), quantity: next.quantity };
    const result = await send(withLang(lang, "/api/languages/player-words"), "PUT", { words: body });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (!next) setWords(draftOf(defaults));
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save(words);
      }}
    >
      <p className="text-muted-foreground text-xs">{t.noBranch}</p>
      <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <span />
        {READERS.map((reader) => (
          <span key={reader.key} className="font-semibold">
            {t.readers[reader.key === "m" ? "male" : "female"]}
          </span>
        ))}
        {FIELDS.map((field) => (
          <Fragment key={field.key}>
            <span>{t.fields[field.key]}</span>
            {READERS.map((reader) => (
              <Input
                key={reader.key}
                aria-label={fill(t.fieldFor, {
                  field: t.fields[field.key],
                  reader: t.readers[reader.key === "m" ? "male" : "female"],
                })}
                required={field.required}
                maxLength={PLAYER_WORD_LIMIT}
                placeholder={t.hints[field.key]}
                value={words[reader.key][field.key]}
                onChange={(event) => setWord(reader.key, field.key, event.target.value)}
              />
            ))}
          </Fragment>
        ))}

        <span className="col-span-3 mt-4 font-semibold">{t.declinedForms}</span>
        {words.cases.map((row, index) => (
          <Fragment key={index}>
            <div className="col-span-3 flex items-center gap-2">
              <label className="flex items-center gap-2">
                {t.caseLabel}
                <Input
                  className="w-14"
                  required
                  inputMode="numeric"
                  pattern="[1-9]"
                  maxLength={1}
                  placeholder="6"
                  value={row.n}
                  onChange={(event) => {
                    const n = event.target.value;
                    patchCase(index, () => ({ n }));
                  }}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => updateCases((cases) => cases.filter((_, at) => at !== index))}
              >
                {t.remove}
              </Button>
            </div>
            {DECLINED.map((kind) => (
              <Fragment key={kind.key}>
                <span className="pl-4">{kind.label}</span>
                {READERS.map((reader) => (
                  <Input
                    key={reader.key}
                    aria-label={fill(t.caseFor, {
                      n: row.n || "N",
                      field: kind.label,
                      reader: t.readers[reader.key === "m" ? "male" : "female"],
                    })}
                    // A word for one reader only leaves the other reader's lines unvoiced.
                    required={row[reader.other][kind.key].trim() !== ""}
                    maxLength={PLAYER_WORD_LIMIT}
                    value={row[reader.key][kind.key]}
                    onChange={(event) => {
                      const value = event.target.value;
                      patchCase(index, (was) => ({ [reader.key]: { ...was[reader.key], [kind.key]: value } }));
                    }}
                  />
                ))}
              </Fragment>
            ))}
          </Fragment>
        ))}
        <div className="col-span-3">
          <Button type="button" variant="outline" size="sm" onClick={() => updateCases((cases) => [...cases, emptyCase()])}>
            {t.addCase}
          </Button>
        </div>

        <span className="col-span-3 mt-4 font-semibold">{t.everyReader}</span>
        <span>{t.quantity}</span>
        <Input
          aria-label={t.quantity}
          className="col-span-2"
          maxLength={PLAYER_WORD_LIMIT}
          placeholder={t.quantityHint}
          value={words.quantity}
          onChange={(event) => {
            const value = event.target.value;
            update((was) => ({ ...was, quantity: value }));
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {saved && <p className="text-muted-foreground text-sm">{t.saved}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {t.save}
        </Button>
        {hasRow && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => save(null)}>
            {defaults ? t.reset : t.removeAll}
          </Button>
        )}
      </div>
    </form>
  );
}
