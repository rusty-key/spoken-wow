"use client";

import type { ReactNode } from "react";

import { Tabs } from "@/components/backstage/Tabs";
import { useUiText } from "@/components/UiTextProvider";
import { langName, localeHref, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";

export type AudioSection = "quests" | "places" | "bosses" | "readables";

const SECTIONS: AudioSection[] = ["quests", "places", "bosses", "readables"];

/**
 * The four audio pages as one place: a title naming the language, the section tabs, and the
 * section's catalogue below. Each tab keeps the team being viewed, so switching section does not
 * quietly switch whose takes are shown.
 */
export default function AudioPage({
  lang,
  section,
  team,
  children,
}: {
  lang: Lang;
  section: AudioSection;
  team?: string;
  children: ReactNode;
}) {
  const t = useUiText().pages;
  const suffix = team ? `?team=${encodeURIComponent(team)}` : "";
  return (
    <main className="bs pb-36">
      <div className="bs-wide">
        <div className="bs-head">
          <div className="min-w-0">
            <h1 className="bs-title">{fill(t.title, { lang: langName(lang) })}</h1>
            <p className="bs-lede">{t.ledes[section]}</p>
          </div>
        </div>
        <Tabs
          label={t.sections}
          active={section}
          tabs={SECTIONS.map((each) => ({
            value: each,
            label: t.tabs[each],
            href: localeHref(lang, `/${each}${suffix}`),
          }))}
        />
      </div>
      {children}
    </main>
  );
}

/** What a section says while its tables are empty, inside the same frame. */
export function AudioPageEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="bs-wide">
      <p className="bs-lede mt-6 max-w-xl">{children}</p>
    </div>
  );
}
