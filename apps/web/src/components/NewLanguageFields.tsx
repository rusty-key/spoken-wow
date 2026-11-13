"use client";

import { Input } from "@/components/ui/input";

export type NewLanguage = { code: string; name: string; native: string };

type Props = { value: NewLanguage; onChange: (value: NewLanguage) => void };

/** The three things a language the site does not know yet needs: its code and both names. */
export default function NewLanguageFields({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="Language code"
        placeholder="Code (xxXX: two lowercase letters, two capitals)"
        pattern="[a-z]{2}[A-Z]{2}"
        required
        value={value.code}
        onChange={(event) => onChange({ ...value, code: event.target.value })}
      />
      <Input
        aria-label="Name in English"
        placeholder="Name in English"
        required
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
      />
      <Input
        aria-label="Name in the language itself"
        placeholder="Name in the language itself"
        required
        value={value.native}
        onChange={(event) => onChange({ ...value, native: event.target.value })}
      />
    </div>
  );
}
