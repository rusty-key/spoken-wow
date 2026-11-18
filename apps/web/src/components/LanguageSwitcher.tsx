"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Refreshing } from "@/components/Loading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localeHref, stripLang, type Lang } from "@/lib/lang";

import { useLang } from "./LangProvider";
import { usePendingPush } from "./usePendingPush";

export type Offered = { code: Lang; name: string; enabled: boolean };

/**
 * Both header switches share one request. Admins can preview disabled languages, so the list
 * belongs to the current session `scope`.
 */
export function useOfferedLanguages(enabled = true, scope = ""): { offered: Offered[]; retry: () => void } {
  const [offered, setOffered] = useState<Offered[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A list answered for another session must not be offered to this one, not even for a moment.
    setOffered([]);
    fetch("/api/languages")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((body: { languages: Offered[] }) => {
        if (!live) return;
        setOffered(body.languages);
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [enabled, scope, attempt]);
  // Cleared as soon as a retry is scheduled, so reopening the menu cannot restart one in flight.
  const retry = useCallback(() => {
    if (!failed) return;
    setFailed(false);
    setAttempt((n) => n + 1);
  }, [failed]);
  return { offered, retry };
}

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
 */
export default function LanguageSwitcher({ offered: given }: { offered?: Offered[] } = {}) {
  const lang = useLang();
  const pathname = usePathname();
  const { pending, push } = usePendingPush();
  // The language asked for, shown until it arrives: the select is controlled by the page's
  // language, and without this it snapped back to the old one for as long as the new page
  // took to render, which read as a switch that had refused.
  const [chosen, setChosen] = useState<string>(lang);
  const { offered: own } = useOfferedLanguages(given === undefined);
  const offered = given ?? own;

  if (offered.length < 2) return null;

  function choose(next: string) {
    const here = `${stripLang(pathname).path}${window.location.search}`;
    setChosen(next);
    push(localeHref(next as Lang, here));
  }

  return (
    <div className="flex items-center gap-1.5">
      {pending && <Refreshing />}
      <Select value={pending ? chosen : lang} onValueChange={choose}>
        <SelectTrigger size="sm" className="w-36" aria-label="Language">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="bn-theme bn-lang-menu">
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
