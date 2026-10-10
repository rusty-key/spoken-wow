"use client";

import Link from "next/link";

import type { ContributionStatus } from "@/lib/contributions/contributions";
import type { Bucket } from "@/lib/contributions/query";
import { cn } from "@/lib/utils";

/** One row of tabs on /contributions; every row uses it, so they all look alike. */
export function LinkTabs({
  label,
  tabs,
  active,
  onGo,
}: {
  label: string;
  /** Each tab's href already localised, keeping whatever else the page is filtered to. */
  tabs: { value: string; label: string; href: string }[];
  active: string;
  /**
   * The table's pending push, so its rows dim while the tab loads: a link to the route already
   * open gets no loading.tsx and shows nothing happening. Without it, a plain link.
   */
  onGo?: (href: string) => void;
}) {
  return (
    <nav aria-label={label} className="mb-3 flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          onClick={(event) => {
            // A modified click opens a tab or a window, which is the link's to do.
            if (!onGo || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onGo(tab.href);
          }}
          aria-current={tab.value === active ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm",
            tab.value === active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

type Props<T extends string> = {
  active: T;
  hrefFor: (value: T) => string;
  onGo: (href: string) => void;
};

function tabsOf<T extends string>(tabs: [T, string][], hrefFor: (value: T) => string) {
  return tabs.map(([value, label]) => ({ value, label, href: hrefFor(value) }));
}

/** Tabs rather than a filter: every row is in exactly one, and only the new ones are worked. */
export default function StatusTabs({ active, hrefFor, onGo }: Props<ContributionStatus>) {
  const tabs = tabsOf<ContributionStatus>(
    [
      ["new", "New"],
      ["accepted", "Accepted"],
      ["rejected", "Rejected"],
    ],
    hrefFor,
  );
  return <LinkTabs label="Status" tabs={tabs} active={active} onGo={onGo} />;
}

/** The New tab split by whether each row can be accepted as it stands. */
export function BucketTabs({ active, hrefFor, onGo, counts }: Props<Bucket> & { counts: Record<Bucket, number> }) {
  const tabs = tabsOf<Bucket>(
    [
      ["ready", `Ready (${counts.ready})`],
      ["blocked", `Needs a speaker (${counts.blocked})`],
    ],
    hrefFor,
  );
  return <LinkTabs label="Bucket" tabs={tabs} active={active} onGo={onGo} />;
}
