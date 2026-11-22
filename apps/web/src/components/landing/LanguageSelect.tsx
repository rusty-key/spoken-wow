"use client";

import { useLang } from "@/components/LangProvider";
import { useLanguageSwitch, useOfferedLanguages } from "@/components/LanguageSwitcher";
import { BUILTIN } from "@/lib/lang";
import { nativeName } from "@/lib/site-text/names";

import { useSiteText } from "./SiteTextProvider";

/** The languages the front page is written in: a team's language would show English under its name. */
const WRITTEN = new Set<string>(BUILTIN.map((language) => language.code));

/**
 * The front page's language switch: a native select in the page's own style, naming each language in
 * itself. A popup portalled to the body would not carry the page's colours and font, which live on
 * the page's own container.
 */
export default function LanguageSelect() {
  const t = useSiteText().nav;
  const lang = useLang();
  const { value, pending, choose } = useLanguageSwitch();
  const { offered, settled } = useOfferedLanguages();

  // Until the list arrives the select holds its place with the page's own language, so the bar does
  // not shift when the others appear.
  if (!settled) {
    return (
      <select className="bn-select bn-select-nav" aria-label={t.language} value={lang} disabled onChange={() => {}}>
        <option value={lang}>{nativeName(lang)}</option>
      </select>
    );
  }
  // The page's own language stays listed even when it is a team's.
  const choices = offered.filter((language) => language.code === lang || WRITTEN.has(language.code));
  if (choices.length < 2) return null;

  return (
    <select
      className="bn-select bn-select-nav"
      aria-label={t.language}
      aria-busy={pending}
      value={value}
      onChange={(event) => choose(event.target.value)}
    >
      {choices.map((language) => (
        <option key={language.code} value={language.code}>
          {nativeName(language.code) + (language.enabled ? "" : ` (${t.off})`)}
        </option>
      ))}
    </select>
  );
}
