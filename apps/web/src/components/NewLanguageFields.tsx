"use client";

import { Input } from "@/components/ui/input";
import { useUiText } from "@/components/UiTextProvider";
import { LANG_SHAPE } from "@/lib/lang";

export type NewLanguage = { code: string; name: string; native: string };

type Props = { value: NewLanguage; onChange: (value: NewLanguage) => void };

/** The three things a language the site does not know yet needs: its code and both names. */
export default function NewLanguageFields({ value, onChange }: Props) {
  const t = useUiText().teams;
  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label={t.languageCode}
        placeholder={t.codePlaceholder}
        pattern={LANG_SHAPE}
        required
        value={value.code}
        onChange={(event) => onChange({ ...value, code: event.target.value })}
      />
      <Input
        aria-label={t.englishName}
        placeholder={t.englishName}
        required
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
      />
      <Input
        aria-label={t.nativeName}
        placeholder={t.nativeName}
        required
        value={value.native}
        onChange={(event) => onChange({ ...value, native: event.target.value })}
      />
    </div>
  );
}
