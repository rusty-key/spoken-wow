"use client";

import { ChevronDown, Globe } from "lucide-react";
import { useState } from "react";

import LocaleLink from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Contained } from "@/components/Width";
import { CODES, langName, type Lang } from "@/lib/lang";
import { cn } from "@/lib/utils";

export type AdminTab = "dashboard" | "team" | "release" | "teams";

const PATHS: Record<AdminTab, string> = {
  dashboard: "/admin/dashboard",
  team: "/admin",
  release: "/admin/release",
  teams: "/admin/teams",
};

/**
 * The top of every admin page: which language it acts on, and the way to the others.
 *
 * The site's own language (the `[lang]` segment) is what the page is read in, not what it
 * administers, and the two differ for anybody who looks after more than one language - so the
 * language acted on is the title, and a team admin is told other languages are other teams'.
 *
 * `lang` is null for the site admin's user list, which spans every language.
 */
export default function AdminHeader({
  lang,
  administered,
  global,
  tab,
  description,
}: {
  lang: Lang | null;
  administered: readonly Lang[];
  global: boolean;
  tab: AdminTab;
  description?: React.ReactNode;
}) {
  const tabs: { tab: AdminTab; label: string }[] = [
    { tab: "dashboard", label: "Dashboard" },
    { tab: "team", label: global && !lang ? "Users" : "Team" },
    { tab: "release", label: "Release" },
    ...(global ? [{ tab: "teams" as const, label: "Teams" }] : []),
  ];
  // The tabs keep the language acted on, so moving between them does not drop back to the first.
  const href = (to: AdminTab) => (lang && to !== "teams" ? `${PATHS[to]}?lang=${lang}` : PATHS[to]);

  return (
    <div className="from-primary/7 border-b bg-gradient-to-b to-transparent">
      <Contained className="pt-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <span className="border-primary/35 bg-primary/10 text-primary-ink rounded-md border px-2 py-0.5 font-mono text-xs">
              {lang ?? "every language"}
            </span>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
              {lang ? `${langName(lang)} team` : tab === "teams" ? "Teams" : "Users"}
            </h1>
            {description && <p className="text-muted-foreground mt-1 max-w-[65ch] text-sm">{description}</p>}
          </div>
          <LanguageSwitch lang={lang} administered={administered} global={global} tab={tab} />
        </div>
        <nav aria-label="Admin" className="mt-5 flex gap-1">
          {tabs.map((item) => (
            <LocaleLink
              key={item.tab}
              href={href(item.tab)}
              aria-current={item.tab === tab ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium",
                item.tab === tab
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {item.label}
            </LocaleLink>
          ))}
        </nav>
      </Contained>
    </div>
  );
}

function LanguageSwitch({
  lang,
  administered,
  global,
  tab,
}: {
  lang: Lang | null;
  administered: readonly Lang[];
  global: boolean;
  tab: AdminTab;
}) {
  const [open, setOpen] = useState(false);
  // A site admin administers every language, so there is nobody else's to list.
  const others = global ? [] : CODES.filter((code) => !administered.includes(code));
  const path = PATHS[tab === "teams" ? "team" : tab];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Globe className="size-4" aria-hidden />
          {lang ? "Switch language" : "Open a language team"}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-96 w-64 overflow-y-auto p-1.5">
        <p className="text-muted-foreground px-2 pt-1.5 pb-1 text-xs">You administer</p>
        {administered.map((code) => (
          <LocaleLink
            key={code}
            href={`${path}?lang=${code}`}
            onClick={() => setOpen(false)}
            aria-current={code === lang ? "page" : undefined}
            className={cn(
              "hover:bg-muted flex justify-between rounded px-2 py-1.5 text-sm",
              code === lang && "text-primary-ink",
            )}
          >
            {langName(code)}
            <span className="text-muted-foreground font-mono text-xs">{code}</span>
          </LocaleLink>
        ))}
        {others.length > 0 && (
          <>
            <p className="text-muted-foreground px-2 pt-3 pb-1 text-xs">Other teams (no access)</p>
            {others.map((code) => (
              <span key={code} className="text-muted-foreground flex justify-between px-2 py-1.5 text-sm">
                {langName(code)}
                <span className="font-mono text-xs">{code}</span>
              </span>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
