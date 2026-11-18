"use client";

import Link from "next/link";

export type TabLink = {
  value: string;
  label: string;
  /** Already localised, keeping whatever else the page is filtered to. */
  href: string;
  count?: number;
};

/**
 * A client-side navigation to `href`, handed to `onGo` (a pending push, so the page can dim while
 * it loads). Next calls onNavigate only for a plain click: Ctrl-, Shift-, Cmd- and Alt-clicks stay
 * the browser's.
 */
function follow(onGo: ((href: string) => void) | undefined, href: string) {
  if (!onGo) return undefined;
  return (event: { preventDefault: () => void }) => {
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
          onNavigate={follow(onGo, tab.href)}
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
          onNavigate={follow(onGo, tab.href)}
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
