"use client";

import { Check, Lock, Plus } from "lucide-react";
import { useState } from "react";

import { CAPABILITY_COLOURS } from "@/components/GrantCell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster, useToast } from "@/components/ui/toast";
import type { GrantRow } from "@/lib/grants/store";
import { langName, type Lang } from "@/lib/lang";
import {
  canGrant,
  capabilityHint,
  capabilityLabel,
  isAdmin,
  type Capability,
  type Viewer,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** Lightest to heaviest, so admin closes the row as the one that covers the rest. */
const COLUMNS: readonly Capability[] = ["text", "edit", "regenerate", "configure", "ignore", "record", "admin"];

type Person = { id: string; name: string | null; email: string };

type Props = {
  lang: Lang;
  /** This language's grants. */
  grants: GrantRow[];
  viewer: Viewer;
  currentUserId: string;
};

// A shell, because useToast has to find a provider above the component that calls it.
export default function TeamMatrix(props: Props) {
  return (
    <Toaster>
      <Matrix {...props} />
    </Toaster>
  );
}

/** Everyone holding something in `grants`, `known` first so nobody moves when a grant goes. */
function peopleOf(known: readonly Person[], grants: readonly GrantRow[]): Person[] {
  const seen = new Map(known.map((person) => [person.id, person]));
  for (const grant of grants) {
    if (!seen.has(grant.userId)) seen.set(grant.userId, { id: grant.userId, name: grant.name, email: grant.email });
  }
  return [...seen.values()];
}

/**
 * Who in one language may do what, one row a person and one column a capability: a tick
 * saves at once, and the toast it raises takes it back.
 *
 * Somebody whose last grant was just removed keeps their row until the page reloads, so an
 * undo has a row to land on and the rows below do not jump under the pointer.
 */
function Matrix({ lang, grants: initial, viewer, currentUserId }: Props) {
  const toast = useToast();
  const [grants, setGrants] = useState(initial);
  const [people, setPeople] = useState(() => peopleOf([], initial));
  // The cell being saved, as `${userId}:${capability}`, or "new" for the add form.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const global = isAdmin(viewer.role);

  const holds = (userId: string, capability: Capability) =>
    grants.some((grant) => grant.userId === userId && grant.capability === capability);

  /** Why a cell cannot be changed here, or null when it can. The server holds the same rules. */
  function lockOf(person: Person, capability: Capability): string | null {
    if (!canGrant(viewer, capability, lang)) return "Only a site admin appoints a text maintainer";
    if (person.id === currentUserId && capability === "admin" && !global) {
      return "You cannot remove your own admin; another admin can";
    }
    return null;
  }

  async function send(method: "PUT" | "DELETE", target: string, body?: unknown): Promise<string | null> {
    const response = await fetch(target, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!response) return "Could not reach the server.";
    const data = (await response.json().catch(() => ({}))) as { grants?: GrantRow[]; error?: string };
    if (!response.ok || !data.grants) return data.error ?? "That did not save.";
    // The route answers with every language the viewer administers; this table is one of them.
    const next = data.grants.filter((grant) => grant.lang === lang);
    setGrants(next);
    setPeople((current) => peopleOf(current, next));
    return null;
  }

  const give = (person: Person, capabilities: Capability[]) =>
    send("PUT", "/api/grants", { email: person.email, lang, capabilities });

  const take = (person: Person, capability: Capability) =>
    send("DELETE", `/api/grants?${new URLSearchParams({ userId: person.id, lang, capability })}`);

  // Says which way rather than flipping, because the undo runs from a toast that outlives this
  // render and would flip whatever the grants were when it was raised.
  async function set(person: Person, capability: Capability, on: boolean, undoable: boolean) {
    setBusy(`${person.id}:${capability}`);
    setError(null);
    const failed = await (on ? give(person, [capability]) : take(person, capability));
    setBusy(null);
    const label = capabilityLabel(capability);
    if (failed) {
      toast({ tone: "error", title: `Could not change ${label} for ${displayName(person)}`, detail: failed });
      return;
    }
    if (!undoable) return;
    toast({
      tone: "info",
      title: on ? `Gave ${displayName(person)} ${label}` : `Took ${label} from ${displayName(person)}`,
      undo: () => void set(person, capability, !on, false),
    });
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy("new");
    setError(null);
    const failed = await give({ id: "", name: null, email: address }, ["edit"]);
    setBusy(null);
    if (failed) {
      setError(failed);
      return;
    }
    setEmail("");
    toast({ tone: "info", title: `Added ${address} to ${langName(lang)}`, detail: "With edit. Tick more in their row." });
  }

  return (
    <div>
      <form onSubmit={add} className="mb-5 flex flex-wrap items-end gap-x-3 gap-y-2">
        <div>
          <label htmlFor="team-add" className="mb-1.5 block text-xs font-medium">
            Add someone to {langName(lang)}
          </label>
          <Input
            id="team-add"
            type="email"
            required
            placeholder="their registered email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={error ? "team-add-error" : "team-add-hint"}
            aria-invalid={error ? true : undefined}
            className="w-72 max-w-full"
          />
        </div>
        <Button type="submit" disabled={busy === "new" || !email.trim()}>
          <Plus className="size-4" aria-hidden />
          Add with edit
        </Button>
        {error ? (
          <p id="team-add-error" role="alert" className="text-destructive pb-2 text-sm">
            {error}
          </p>
        ) : (
          <p id="team-add-hint" className="text-muted-foreground pb-2 text-sm">
            They need an account on the site first.
          </p>
        )}
      </form>

      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40 border-b">
              <th scope="col" className="py-3 pl-4 text-left text-xs font-medium">
                Person
              </th>
              {COLUMNS.map((capability) => (
                <th key={capability} scope="col" className="w-24 px-1 pt-3 pb-2.5 align-bottom text-xs font-medium">
                  <ColumnHeading capability={capability} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="text-muted-foreground px-4 py-6">
                  Nobody works on {langName(lang)} yet. Add somebody by their email above.
                </td>
              </tr>
            )}
            {people.map((person) => (
              <tr key={person.id} className="hover:bg-muted/20 border-b last:border-0">
                <th scope="row" className="py-3 pr-3 pl-4 text-left font-normal">
                  <span className="font-semibold">{displayName(person)}</span>
                  {person.id === currentUserId && (
                    <span className="border-primary/35 text-primary-ink ml-2 rounded-full border px-1.5 text-[11px] font-medium">
                      you
                    </span>
                  )}
                  <span className="text-muted-foreground block text-xs">{person.email}</span>
                </th>
                {COLUMNS.map((capability) => (
                  <td key={capability} className={cn("text-center", capability === "admin" && "bg-rose-500/[0.03]")}>
                    <Tick
                      on={holds(person.id, capability)}
                      capability={capability}
                      lock={lockOf(person, capability)}
                      busy={busy === `${person.id}:${capability}`}
                      // Every save answers with the whole listing, so a second tick before the
                      // first answered could be overwritten on screen by the slower reply.
                      frozen={busy !== null}
                      label={`${capabilityLabel(capability)} for ${displayName(person)}`}
                      onToggle={() => void set(person, capability, !holds(person.id, capability), true)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" aria-hidden /> can&apos;t be changed here
        </span>
        <span>Point at a column for what it allows. A tick saves at once, and you can undo it.</span>
      </p>
      {!global && (
        <p className="text-muted-foreground mt-8 max-w-[65ch] rounded-lg border border-dashed p-4 text-sm">
          Only people working on {langName(lang)} are listed. If somebody here also helps another
          language, that team&apos;s admins look after their access there.
        </p>
      )}
    </div>
  );
}

function displayName(person: Person): string {
  return person.name || person.email.split("@")[0];
}

function ColumnHeading({ capability }: { capability: Capability }) {
  const hint = `tip-${capability}`;
  return (
    <span className="group relative inline-flex flex-col items-center gap-1.5">
      <span
        aria-hidden
        className={cn("size-2 rounded-sm border", CAPABILITY_COLOURS[capability])}
      />
      {/* Focusable so the meaning reaches somebody who cannot point at it. */}
      <span tabIndex={0} aria-describedby={hint} className="cursor-help rounded">
        {capabilityLabel(capability)}
      </span>
      <span
        id={hint}
        role="tooltip"
        className="bg-popover text-popover-foreground pointer-events-none absolute top-full z-10 mt-2 hidden w-56 rounded-md border px-2.5 py-2 text-left text-xs leading-relaxed font-normal shadow-lg group-focus-within:block group-hover:block"
      >
        {capabilityHint(capability)}
      </span>
    </span>
  );
}

function Tick({
  on,
  capability,
  lock,
  busy,
  frozen,
  label,
  onToggle,
}: {
  on: boolean;
  capability: Capability;
  lock: string | null;
  busy: boolean;
  frozen: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      aria-disabled={lock ? true : undefined}
      aria-busy={busy || undefined}
      title={lock ?? undefined}
      disabled={frozen}
      onClick={lock ? undefined : onToggle}
      className={cn(
        "inline-grid size-8 place-items-center rounded-md border transition-colors",
        on ? CAPABILITY_COLOURS[capability] : "border-border hover:border-foreground/40",
        lock && "cursor-not-allowed",
        lock && !on && "border-dashed hover:border-border",
        busy && "animate-pulse",
      )}
    >
      {on && (lock ? <Lock className="size-3.5" aria-hidden /> : <Check className="size-4" strokeWidth={2.5} aria-hidden />)}
    </button>
  );
}
