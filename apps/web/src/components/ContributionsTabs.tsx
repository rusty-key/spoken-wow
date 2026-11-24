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
  names,
  showNames,
}: {
  lang: Lang;
  section: Section | "names";
  pending?: PendingCounts;
  names?: number;
  /** Whether the language has observed names; `lib/names/observed` is server-only, so the page decides. */
  showNames: boolean;
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
        ...(!showNames
          ? []
          : [
              {
                value: "names",
                label: t.tabs.names,
                href: localeHref(lang, "/contributions/names"),
                count: names,
              },
            ]),
      ]}
    />
  );
}
