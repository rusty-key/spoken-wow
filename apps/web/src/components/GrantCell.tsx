"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GrantRow } from "@/lib/grants/store";
import { CODES, isLang, langName, type Lang } from "@/lib/lang";
import { CAPABILITIES, canGrant, capabilityLabel, type Capability, type Viewer } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * A tint per capability, so who can do what reads down the column without reading the
 * words. The heavier the capability, the warmer: admin is the only red one.
 */
const CAPABILITY_COLOURS: Record<Capability, string> = {
  text: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  edit: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  regenerate: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  record: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  ignore: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  configure: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  admin: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/**
 * One person's languages: what they hold in each, every capability removable, and a way to
 * add another.
 *
 * Offers only what `viewer` may hand out (lib/permissions.ts `canGrant`), so a language
 * admin sees the team capabilities in their own languages and nothing else. The server
 * refuses anything else whatever this offers.
 */
export default function GrantCell({
  grants,
  viewer,
  busy,
  onGrant,
  onRevoke,
}: {
  /** This person's grants, as far as the viewer may see them. */
  grants: readonly GrantRow[];
  viewer: Viewer;
  busy: boolean;
  onGrant: (lang: Lang, capabilities: Capability[]) => Promise<boolean>;
  onRevoke: (lang: Lang, capability: Capability) => void;
}) {
  // Which popover is open: "new" for any language, or the language whose "+" was clicked.
  const [open, setOpen] = useState<"new" | Lang | null>(null);
  const byLang = new Map<Lang, Capability[]>();
  for (const grant of grants) {
    if (!isLang(grant.lang)) continue;
    const held = byLang.get(grant.lang);
    if (held) held.push(grant.capability);
    else byLang.set(grant.lang, [grant.capability]);
  }
  const offer = (lang: Lang) =>
    CAPABILITIES.filter((cap) => canGrant(viewer, cap, lang) && !byLang.get(lang)?.includes(cap));

  return (
    <div className="flex flex-col items-start gap-1">
      {[...byLang].map(([lang, capabilities]) => (
        <div key={lang} className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground min-w-24 text-xs">{langName(lang)}</span>
          {capabilities.map((capability) => {
            const removable = canGrant(viewer, capability, lang);
            return (
              <Badge
                key={capability}
                variant="outline"
                className={cn(CAPABILITY_COLOURS[capability], removable && "pr-0.5")}
              >
                {capabilityLabel(capability)}
                {removable ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${capabilityLabel(capability)} in ${langName(lang)}`}
                    className="rounded-full px-1 opacity-60 hover:opacity-100 disabled:opacity-30"
                    onClick={() => onRevoke(lang, capability)}
                  >
                    ×
                  </button>
                ) : null}
              </Badge>
            );
          })}
          {offer(lang).length > 0 ? (
            <GrantPopover
              open={open === lang}
              onOpenChange={(next) => setOpen(next ? lang : null)}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy}
                  aria-label={`Grant more in ${langName(lang)}`}
                >
                  +
                </Button>
              }
            >
              <GrantPicker
                offer={offer}
                lang={lang}
                busy={busy}
                onPick={(lang, capabilities) =>
                  void onGrant(lang, capabilities).then((ok) => {
                    if (ok) setOpen(null);
                  })
                }
              />
            </GrantPopover>
          ) : null}
        </div>
      ))}
      {CODES.some((lang) => offer(lang).length > 0) ? (
        <GrantPopover
          open={open === "new"}
          onOpenChange={(next) => setOpen(next ? "new" : null)}
          trigger={
            // Pulled left by its own padding, so its text lines up with the language names.
            <Button variant="ghost" size="xs" disabled={busy} className="-ml-2">
              + Grant
            </Button>
          }
        >
          <GrantPicker
            offer={offer}
            busy={busy}
            onPick={(lang, capabilities) =>
              void onGrant(lang, capabilities).then((ok) => {
                if (ok) setOpen(null);
              })
            }
          />
        </GrantPopover>
      ) : null}
    </div>
  );
}

function GrantPopover({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* Mounted only while open, so the choice starts fresh each time. */}
      <PopoverContent align="start" className="w-auto max-w-[min(32rem,calc(100vw-2rem))]">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A language, the capabilities to give in it, and a button: what every grant is made from.
 * Several at once, since somebody brought into a language usually needs more than one.
 *
 * `offer` says what may be granted in each language; languages it offers nothing in are
 * left out, and changing the language clears what was ticked. `lang` fixes the language and
 * hides its select, for adding to one somebody already holds.
 */
export function GrantPicker({
  offer,
  lang: fixed,
  busy,
  onPick,
  children,
}: {
  offer: (lang: Lang) => readonly Capability[];
  lang?: Lang;
  busy: boolean;
  onPick: (lang: Lang, capabilities: Capability[]) => void;
  /** Anything to put before the selects, such as an email field; the whole is one form. */
  children?: React.ReactNode;
}) {
  const langs = CODES.filter((code) => offer(code).length > 0);
  const [lang, setLang] = useState(fixed ?? langs[0]);
  const [picked, setPicked] = useState<ReadonlySet<Capability>>(new Set());
  const offered = lang ? offer(lang) : [];

  const toggle = (capability: Capability) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(capability)) next.add(capability);
      return next;
    });

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        // In CAPABILITIES' order, whatever order they were ticked in.
        if (lang && picked.size) onPick(lang, offered.filter((cap) => picked.has(cap)));
      }}
    >
      {children}
      {fixed ? null : (
        <Select
          value={lang}
          onValueChange={(value) => {
            setLang(value as Lang);
            setPicked(new Set());
          }}
        >
          <SelectTrigger className="w-40" aria-label="Language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {langs.map((code) => (
              <SelectItem key={code} value={code}>
                {langName(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div role="group" aria-label="Capabilities" className="flex flex-wrap gap-1">
        {offered.map((cap) => (
          <Button
            key={cap}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={picked.has(cap)}
            className={cn(picked.has(cap) ? CAPABILITY_COLOURS[cap] : "text-muted-foreground")}
            onClick={() => toggle(cap)}
          >
            {capabilityLabel(cap)}
          </Button>
        ))}
      </div>
      <Button type="submit" size="sm" disabled={busy || !lang || picked.size === 0}>
        {fixed ? `Grant in ${langName(fixed)}` : "Grant"}
      </Button>
    </form>
  );
}
