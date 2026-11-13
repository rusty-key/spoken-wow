"use client";

import { Check, Lock, Plus } from "lucide-react";
import { useRef, useState } from "react";

import { CAPABILITY_COLOURS } from "@/components/GrantCell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster, useToast } from "@/components/ui/toast";
import { giveGrants, resendInvite, revokeInvite, takeGrant } from "@/lib/grants/client";
import type { GrantRow } from "@/lib/grants/store";
import type { InviteRow } from "@/lib/invites/store";
import { langName, type Lang } from "@/lib/lang";
import {
  canGrant,
  capabilityHint,
  capabilityLabel,
  isAdmin,
  removesOwnAdmin,
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
  /** This language's open invites. */
  invites: InviteRow[];
  viewer: Viewer;
  /** Whether this language's team admins appoint its text maintainers. */
  textByTeam: boolean;
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
function Matrix({ lang, grants: initial, invites: initialInvites, viewer, textByTeam, currentUserId }: Props) {
  const toast = useToast();
  const [grants, setGrants] = useState(initial);
  const [people, setPeople] = useState(() => peopleOf([], initial));
  // The cell being saved, as `${userId}:${capability}`, or "new" for the add form.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const offered = COLUMNS.filter((capability) => canGrant(viewer, capability, lang, textByTeam));
  const [chosen, setChosen] = useState<Capability[]>(["edit"]);
  const global = isAdmin(viewer.role);

  // Saves one after another, an undo from a toast included: every save answers with the whole
  // listing, and a slower reply landing after a newer one would put the older state on screen.
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const holds = (userId: string, capability: Capability) =>
    grants.some((grant) => grant.userId === userId && grant.capability === capability);

  /** `admin` in a language is every capability there but `text`, as permissions.ts `can` reads it. */
  const implied = (userId: string, capability: Capability) =>
    capability !== "admin" && capability !== "text" && holds(userId, "admin");

  /** Why a cell cannot be changed here, or null when it can. The server holds the same rules. */
  function lockOf(person: Person, capability: Capability): string | null {
    if (!canGrant(viewer, capability, lang, textByTeam)) return "Only a site admin appoints a text maintainer";
    if (implied(person.id, capability)) return "Included in their admin";
    if (removesOwnAdmin(viewer, currentUserId, person.id, capability)) {
      return "You cannot remove your own admin; another admin can";
    }
    return null;
  }

  /** Why it did not save, or null when it did. */
  function adopt(answer: Awaited<ReturnType<typeof takeGrant>>): string | null {
    if (!answer.grants) return answer.error ?? "That did not save.";
    // The route answers with every language the viewer administers; this table is one of them.
    const next = answer.grants.filter((grant) => grant.lang === lang);
    setGrants(next);
    setInvites((answer.invites ?? []).filter((invite) => invite.lang === lang));
    setPeople((current) => peopleOf(current, next));
    return null;
  }

  const give = async (person: Person, capabilities: Capability[]) =>
    adopt(await giveGrants(person.email, lang, capabilities));

  const take = async (person: Person, capability: Capability) => adopt(await takeGrant(person.id, lang, capability));

  // Says which way rather than flipping, because the undo runs from a toast that outlives this
  // render and would flip whatever the grants were when it was raised.
  function set(person: Person, capability: Capability, on: boolean, undoable: boolean): Promise<void> {
    const run = saving.current.then(() => save(person, capability, on, undoable));
    saving.current = run;
    return run;
  }

  async function save(person: Person, capability: Capability, on: boolean, undoable: boolean) {
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
    const answer = await giveGrants(address, lang, chosen);
    const failed = adopt(answer);
    setBusy(null);
    if (failed) {
      setError(failed);
      return;
    }
    setEmail("");
    toast({
      tone: "info",
      title: `${answer.invited ? "Invited" : "Added"} ${address} to ${langName(lang)}`,
      detail: `With ${chosen.map(capabilityLabel).join(", ")}.`,
    });
  }

  async function manage(invite: InviteRow, send: typeof resendInvite, done: string) {
    setBusy(`invite:${invite.id}`);
    const failed = adopt(await send(invite.id));
    setBusy(null);
    toast(
      failed
        ? { tone: "error", title: `Could not change the invite to ${invite.email}`, detail: failed }
        : { tone: "info", title: `${done} ${invite.email}` },
    );
  }

  return (
    <div>
      <form onSubmit={add} aria-label={`Add someone to ${langName(lang)}`} className="mb-5 flex flex-wrap items-end gap-x-3 gap-y-2">
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
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1 pb-2">
          <legend className="sr-only">As</legend>
          {offered.map((capability) => (
            <label key={capability} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(capability)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked ? [...current, capability] : current.filter((c) => c !== capability),
                  )
                }
              />
              {capabilityLabel(capability)}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={busy === "new" || !email.trim() || chosen.length === 0}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
        {error ? (
          <p id="team-add-error" role="alert" className="text-destructive pb-2 text-sm">
            {error}
          </p>
        ) : (
          <p id="team-add-hint" className="text-muted-foreground pb-2 text-sm">
            Somebody without an account gets an email invite.
          </p>
        )}
      </form>

      {invites.length > 0 && (
        <section className="mb-5" aria-labelledby="pending-invites">
          <h2 id="pending-invites" className="mb-2 text-sm font-semibold">
            Pending invites
          </h2>
          <ul className="bg-card divide-y rounded-lg border text-sm">
            {invites.map((invite) => {
              const allowed = invite.capabilities.every((capability) => canGrant(viewer, capability, lang, textByTeam));
              return (
                <li key={invite.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <span className="font-semibold">{invite.email}</span>
                  <span>{invite.capabilities.map(capabilityLabel).join(", ")}</span>
                  <span className="text-muted-foreground text-xs">
                    invited by {invite.invitedByName ?? "someone"}, sent {new Date(invite.sentAt).toLocaleDateString()},{" "}
                    {invite.expired ? "expired" : `expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!allowed || busy !== null}
                      onClick={() => void manage(invite, resendInvite, "Sent again to")}
                    >
                      Resend
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!allowed || busy !== null}
                      onClick={() => void manage(invite, revokeInvite, "Revoked the invite to")}
                    >
                      Revoke
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
                      id={`${person.id}-${capability}`}
                      on={holds(person.id, capability) || implied(person.id, capability)}
                      implied={implied(person.id, capability)}
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
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-3.5 opacity-55" aria-hidden /> comes with their admin
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
  id,
  on,
  implied,
  capability,
  lock,
  busy,
  frozen,
  label,
  onToggle,
}: {
  id: string;
  on: boolean;
  /** Held through admin rather than granted: shown ticked, and changed by changing admin. */
  implied: boolean;
  capability: Capability;
  lock: string | null;
  busy: boolean;
  frozen: boolean;
  label: string;
  onToggle: () => void;
}) {
  const reason = `lock-${id}`;
  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={label}
        aria-disabled={lock ? true : undefined}
        // The reason in words for a screen reader and a touch screen, where a title never shows.
        aria-describedby={lock ? reason : undefined}
        aria-busy={busy || undefined}
        title={lock ?? undefined}
        disabled={frozen}
        onClick={lock ? undefined : onToggle}
        className={cn(
          "inline-grid size-8 place-items-center rounded-md border transition-colors",
          on ? CAPABILITY_COLOURS[capability] : "border-border hover:border-foreground/40",
          implied && "opacity-55",
          lock && "cursor-not-allowed",
          lock && !on && "border-dashed hover:border-border",
          busy && "animate-pulse",
        )}
      >
        {on &&
          (lock && !implied ? (
            <Lock className="size-3.5" aria-hidden />
          ) : (
            <Check className="size-4" strokeWidth={2.5} aria-hidden />
          ))}
      </button>
      {lock && (
        <span id={reason} className="sr-only">
          {lock}
        </span>
      )}
    </>
  );
}
