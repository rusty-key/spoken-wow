"use client";

import { Chips } from "@/components/backstage/Tabs";
import { useUiText } from "@/components/UiTextProvider";
import type { PendingCounts } from "@/lib/contributions/pending";
import { SECTIONS, type Section } from "@/lib/contributions/query";
import { localeHref, type Lang } from "@/lib/lang";
import { hasObservedNames } from "@/lib/names/observed";

/**
 * The sections of /contributions as chips, each with how many new rows wait in it, corrections to
 * lines the corpus has included. Links, not client state: each section is its own page.
 */
export default function ContributionsTabs({
  lang,
  section,
  pending,
  names,
}: {
  lang: Lang;
  section: Section | "names";
  pending?: PendingCounts;
  names?: number;
}) {
  const t = useUiText().pages;
  return (
    <Chips
      label={t.sections}
      active={section}
      tabs={[
        ...SECTIONS.map((key) => ({
          value: key,
          label: t.tabs[key],
          href: localeHref(lang, `/contributions/${key}`),
          count: pending?.sections[key],
        })),
        ...(!hasObservedNames(lang)
          ? []
          : [
              {
                value: "names",
                label: t.names,
                href: localeHref(lang, "/contributions/names"),
                count: names,
              },
            ]),
      ]}
    />
  );
}
