"use client";

import { ChevronDown, ChevronRight, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { DAY, useLocalDates } from "@/components/useLocalDates";
import { fill } from "@/lib/site-text/format";
import { useSearchBox } from "@/components/useSearchBox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";
import { updatePack } from "@/lib/community/admin-client";
import type { Pack, Submission } from "@/lib/community/store";
import { roleLabel } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { nameOf } from "./common";

type Row = Pack & { history: Submission[] };

const STATUS: Record<Submission["status"], string> = {
  pending: "text-primary-ink",
  approved: "text-foreground",
  rejected: "text-destructive",
  withdrawn: "text-muted-foreground",
};

/** The newest submission's title stands for the pack; the live one is what players see, so it wins. */
function titleOf(pack: Row): string | null {
  return pack.live?.title ?? pack.history[0]?.title ?? null;
}

export default function PackAdminTable({ packs, names }: { packs: Row[]; names: Record<string, string> }) {
  const t = useUiText().packs.admin;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function change(pack: Row, change: { ownerId?: string | null; listed?: boolean }, done: string) {
    setBusy(pack.id);
    const result = await updatePack(pack.id, change);
    setBusy(null);
    router.refresh();
    if (result.ok) toast({ tone: "info", title: done });
    else toast({ tone: "error", title: fill(t.couldNotChange, { pack: pack.id }), detail: result.error });
  }

  if (packs.length === 0) {
    return <p className="text-muted-foreground py-3 text-sm">{t.noPacks}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-normal">{t.pack}</th>
            <th className="py-2 pr-3 font-normal">{t.titleColumn}</th>
            <th className="py-2 pr-3 font-normal">{t.languageColumn}</th>
            <th className="py-2 pr-3 font-normal">{t.ownerColumn}</th>
            <th className="py-2 pr-3 font-normal">{t.liveColumn2}</th>
            <th className="py-2 pr-3 font-normal">{t.listedColumn}</th>
            <th className="py-2 font-normal">{t.historyColumn}</th>
          </tr>
        </thead>
        <tbody>
          {packs.map((pack) => {
            const expanded = open === pack.id;
            const title = titleOf(pack);
            return (
              <Fragment key={pack.id}>
                <tr className={cn("align-middle", !expanded && "border-b")}>
                  <td className="py-2 pr-3 font-mono text-xs">{pack.id}</td>
                  <td className="py-2 pr-3">
                    {title ?? <span className="text-muted-foreground">{t.none}</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant="outline">{pack.lang}</Badge>{" "}
                    <span className="text-muted-foreground text-xs">{pack.section}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <OwnerPicker
                      pack={pack}
                      disabled={busy === pack.id}
                      onPick={(owner) =>
                        change(
                          pack,
                          { ownerId: owner?.id ?? null },
                          owner
                            ? fill(t.handedTo, { pack: pack.id, name: owner.name || owner.email })
                            : fill(t.noOwnerNow, { pack: pack.id }),
                        )
                      }
                    />
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {pack.live ? (
                      `v${pack.live.version}`
                    ) : (
                      <span className="text-muted-foreground font-sans">{t.notYet}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        aria-label={fill(t.listedLabel, { pack: pack.id })}
                        checked={pack.listed}
                        disabled={busy === pack.id}
                        onCheckedChange={(checked) =>
                          change(
                            pack,
                            { listed: checked === true },
                            checked === true
                              ? fill(t.listedAgain, { pack: pack.id })
                              : fill(t.unlistedIt, { pack: pack.id }),
                          )
                        }
                      />
                      <span className={cn("text-xs", !pack.listed && "text-muted-foreground")}>
                        {pack.listed ? t.listedWord : t.unlistedWord}
                      </span>
                    </label>
                  </td>
                  <td className="py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded}
                      aria-controls={`history-${pack.id}`}
                      aria-label={fill(t.historyOf, { pack: pack.id, n: pack.history.length })}
                      onClick={() => setOpen(expanded ? null : pack.id)}
                    >
                      {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                      {t.history}
                      <span className="text-muted-foreground tabular-nums">{pack.history.length}</span>
                    </Button>
                  </td>
                </tr>
                {expanded && (
                  <tr id={`history-${pack.id}`} className="border-b">
                    <td colSpan={7} className="pb-3">
                      <History submissions={pack.history} names={names} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function History({ submissions, names }: { submissions: Submission[]; names: Record<string, string> }) {
  const t = useUiText().packs.admin;
  const when = useLocalDates();
  const who = (id: string | null) => nameOf(id, id && names[id]);
  return (
    <ol className="bg-muted/40 divide-y rounded-md text-xs">
      {submissions.map((submission) => {
        const status = STATUS[submission.status];
        return (
          <li key={submission.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="w-24 shrink-0 font-mono">v{submission.version}</span>
            <span
              className={cn("w-20 shrink-0 font-medium", STATUS[submission.status])}
            >
              {t.statusWord[submission.status]}
            </span>
            <span className="text-muted-foreground">
              {fill(t.sentByOn, {
                when: when(submission.submittedAt, DAY),
                name: who(submission.submittedBy),
              })}
              {submission.reviewedAt &&
                fill(t.decidedByOn, {
                  when: when(submission.reviewedAt, DAY),
                  name: who(submission.reviewedBy),
                })}
            </span>
            {submission.rejectReason && (
              <p className="text-foreground basis-full pl-[6.75rem] whitespace-pre-wrap">{submission.rejectReason}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type Found = { id: string; name: string; email: string; role?: string | null };

// A search keeps the last answer on screen while the next one loads, so typing does not flicker.
type Search =
  | { state: "idle" }
  | { state: "loading"; users: Found[] | null }
  | { state: "error" }
  | { state: "done"; users: Found[] };

async function findUsers(query: string): Promise<Found[]> {
  const ask = (searchField: "name" | "email") =>
    authClient.admin.listUsers({ query: { searchValue: query, searchField, searchOperator: "contains", limit: 8 } });
  const answers = await Promise.all([ask("name"), ask("email")]);
  const found = new Map<string, Found>();
  for (const { data } of answers) for (const user of data?.users ?? []) found.set(user.id, user);
  return [...found.values()].slice(0, 8);
}

/** A pack outlives its author's account, so an admin can hand it to somebody else or to nobody. */
function OwnerPicker({
  pack,
  disabled,
  onPick,
}: {
  pack: Row;
  disabled: boolean;
  onPick: (owner: Found | null) => void;
}) {
  const t = useUiText().packs.admin;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [query, setQuery] = useSearchBox("", (next) => {
    const wanted = next.trim();
    if (!wanted) return setSearch({ state: "idle" });
    setSearch((last) => ({ state: "loading", users: "users" in last ? last.users : null }));
    findUsers(wanted)
      .then((users) => setSearch({ state: "done", users }))
      .catch(() => setSearch({ state: "error" }));
  });
  const users = "users" in search ? search.users : null;

  const current = pack.ownerId ? nameOf(pack.ownerId, pack.ownerName) : null;

  function pick(owner: Found | null) {
    setOpen(false);
    setQuery("");
    setSearch({ state: "idle" });
    onPick(owner);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={fill(t.ownerOfPack, { pack: pack.id, owner: current ?? t.none })}
        >
          <UserRound aria-hidden />
          {current ?? <span className="text-muted-foreground">{t.noOwner}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <Input
          type="search"
          value={query}
          placeholder={t.nameOrEmail}
          aria-label={t.findUser}
          className="h-8"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-1 max-h-64 overflow-y-auto">
          {search.state === "error" ? (
            <p className="text-destructive px-2 py-1.5 text-xs">{t.searchFailed}</p>
          ) : search.state === "loading" && !users ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">{t.searching}</p>
          ) : users?.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">{t.nobodyMatches}</p>
          ) : (
            users?.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => pick(user)}
                disabled={user.id === pack.ownerId}
                className="hover:bg-muted flex w-full flex-col rounded px-2 py-1.5 text-left text-sm disabled:opacity-50"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{user.name || user.email}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{roleLabel(user.role)}</span>
                </span>
                <span className="text-muted-foreground truncate text-xs">{user.email}</span>
              </button>
            ))
          )}
        </div>
        {pack.ownerId && (
          <>
            <div className="bg-border my-1 h-px" />
            <button
              type="button"
              onClick={() => pick(null)}
              className="hover:bg-muted text-muted-foreground hover:text-foreground w-full rounded px-2 py-1.5 text-left text-sm"
            >
              {t.clearOwner}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
