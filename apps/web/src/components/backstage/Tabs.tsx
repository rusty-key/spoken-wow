"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

export type TabLink = {
  value: string;
  label: string;
  /** Already localised, keeping whatever else the page is filtered to. */
  href: string;
  count?: number;
};

/**
 * A plain click on a tab, handed to `onGo` (a pending push, so the page can dim while it loads).
 * A modified click opens a tab or a window, which is the link's own to do.
 */
function follow(onGo: ((href: string) => void) | undefined, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onGo || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onGo(href);
  };
}

/** Tabs with the front page's gold underline: where a page splits into views. */
export function Tabs({
  label,
  tabs,
  active,
  onGo,
}: {
  label: string;
  tabs: TabLink[];
  active: string;
  onGo?: (href: string) => void;
}) {
  return (
    <nav aria-label={label} className="bs-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          onClick={follow(onGo, tab.href)}
          aria-current={tab.value === active ? "page" : undefined}
          className="bs-tab"
        >
          {tab.label}
          {tab.count !== undefined ? <span className="bs-count">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Pills for a smaller choice inside a view, such as which section a list shows. */
export function Chips({
  label,
  tabs,
  active,
  onGo,
}: {
  label: string;
  tabs: TabLink[];
  active: string;
  onGo?: (href: string) => void;
}) {
  return (
    <nav aria-label={label} className="bs-chips">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          onClick={follow(onGo, tab.href)}
          aria-current={tab.value === active ? "page" : undefined}
          className="bs-chip"
        >
          {tab.label}
          {tab.count !== undefined ? <span className="bs-count">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
