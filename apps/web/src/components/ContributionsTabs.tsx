"use client";

import { Chips } from "@/components/backstage/Tabs";
import { useUiText } from "@/components/UiTextProvider";
import type { PendingCounts } from "@/lib/contributions/pending";
import { SECTIONS, type Section } from "@/lib/contributions/query";
import { localeHref, type Lang } from "@/lib/lang";

/**
 * The sections of /contributions as chips, each with how many new rows wait in it, corrections to
 * lines the corpus has included. Links, not client state: each section is its own page.
 */
export default function ContributionsTabs({
  lang,
  section,
  pending,
}: {
  lang: Lang;
  section: Section;
  pending?: PendingCounts;
}) {
  const t = useUiText().pages;
  return (
    <Chips
      label={t.sections}
      active={section}
      tabs={SECTIONS.map((key) => ({
        value: key,
        label: t.tabs[key],
        href: localeHref(lang, `/contributions/${key}`),
        count: pending?.sections[key],
      }))}
    />
  );
}
