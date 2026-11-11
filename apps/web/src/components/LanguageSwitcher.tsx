"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Refreshing } from "@/components/Loading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localeHref, stripLang, type Lang } from "@/lib/lang";
import { FRONT_PAGE_LANGS, nativeName } from "@/lib/site-text/names";

import { useLang } from "./LangProvider";
import { usePendingPush } from "./usePendingPush";

type Offered = { code: Lang; name: string; enabled: boolean };

/**
 * The site's one language switch.
 *
 * Moves the page the reader is on to the same page in another language -- same path, same
 * query -- rather than to the landing page, since a switch that loses the search a reader
 * just ran is a switch nobody uses twice.
 *
 * Asked of the API in the browser rather than read by the layout, for the reason UserMenu
 * reads the session there: the layout would otherwise put a query in front of every English
 * page. Renders nothing while only one language is on, which is the site as it stands.
 *
 * On the front page (`variant="landing"`) it is a native select in that page's own style, with
 * each language named in itself. A popup portalled to the body would not carry the page's
 * colours and font, which live on the page's own container.
 */
export default function LanguageSwitcher({ variant, label }: { variant?: "landing"; label?: string }) {
  const lang = useLang();
  const pathname = usePathname();
  const { pending, push } = usePendingPush();
  // The language asked for, shown until it arrives: the select is controlled by the page's
  // language, and without this it snapped back to the old one for as long as the new page
  // took to render, which read as a switch that had refused.
  const [chosen, setChosen] = useState<string>(lang);
  const [offered, setOffered] = useState<Offered[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/languages")
      .then((response) => (response.ok ? response.json() : { languages: [] }))
      .then((body: { languages: Offered[] }) => {
        if (live) setOffered(body.languages);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Until the list arrives the front page holds the select's place with the page's own language, so
  // the bar does not shift when the others appear.
  if (variant === "landing" && !loaded) {
    return (
      <select className="bn-select bn-select-nav" aria-label={label} value={lang} disabled onChange={() => {}}>
        <option value={lang}>{nativeName(lang)}</option>
      </select>
    );
  }
  // The front page's select lists the languages it is written in, and the page's own language even if it is not.
  const choices =
    variant === "landing"
      ? offered.filter((language) => language.code === lang || FRONT_PAGE_LANGS.includes(language.code))
      : offered;
  if (choices.length < 2) return null;

  function choose(next: string) {
    const here = `${stripLang(pathname).path}${window.location.search}`;
    setChosen(next);
    push(localeHref(next as Lang, here));
  }

  if (variant === "landing") {
    return (
      <select
        className="bn-select bn-select-nav"
        aria-label={label}
        aria-busy={pending}
        value={pending ? chosen : lang}
        onChange={(event) => choose(event.target.value)}
      >
        {choices.map((language) => (
          <option key={language.code} value={language.code}>
            {nativeName(language.code) + (language.enabled ? "" : " (off)")}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {pending && <Refreshing />}
      <Select value={pending ? chosen : lang} onValueChange={choose}>
        <SelectTrigger size="sm" className="w-36" aria-label="Language">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {offered.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {language.name}
              {language.enabled ? "" : " (off)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
