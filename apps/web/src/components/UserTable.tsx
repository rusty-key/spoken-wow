"use client";

import { useMemo, useState } from "react";

import GrantCell, { GrantPicker } from "@/components/GrantCell";
import Cell from "@/components/Cell";
import Pagination from "@/components/Pagination";
import SortHeader from "@/components/SortHeader";
import { usePendingPush } from "@/components/usePendingPush";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import type { GrantRow } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { nextUserSort, usersQuery, type UserSort } from "@/lib/users/sort";
import { cn } from "@/lib/utils";
import {
  CAPABILITIES,
  canGrant,
  isAdmin,
  ROLES,
  type Capability,
  type Role,
  type Viewer,
} from "@/lib/permissions";

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  /** Present for a global admin's listing only, as are the joined date and the key. */
  role?: string | null | undefined;
  createdAt?: string;
};

const NONE: readonly GrantRow[] = [];

type Props = {
  users: UserRow[];
  /** Every grant the viewer may see: all of them for an admin, their languages' otherwise. */
  grants: GrantRow[];
  viewer: Viewer;
  /** The signed-in user, whose own role is deliberately not editable here. */
  currentUserId: string;
  /**
   * Who holds a key. Presence only - no value crosses this boundary. Null for a language
   * admin, who hands out nothing that spends on anybody else's behalf and so takes nothing
   * back.
   */
  keyedUserIds: string[] | null;
  /**
   * The search. A global admin's `users` are already its matches; a language admin's list is
   * filtered here.
   */
  q: string;
  /** Likewise: a global admin's `users` come in this order, a language admin's are put in it here. */
  sort: UserSort;
  /** Where a global admin's list is; null for a language admin's, which is not paged. */
  page: { page: number; pageCount: number } | null;
};

function matches(user: UserRow, q: string): boolean {
  const needle = q.toLowerCase();
  return user.email.toLowerCase().includes(needle) || (user.name?.toLowerCase().includes(needle) ?? false);
}

/**
 * A language admin's order, the server's for a global admin's (lib/users/store): languages is
 * the languages held, alphabetically joined, admins first; empty values last either way.
 */
function compareUsers(sort: UserSort, langsOf: (user: UserRow) => string | null) {
  const key = (user: UserRow): string | null => {
    switch (sort.column) {
      case "name":
        return user.name || null;
      case "email":
        return user.email;
      case "joined":
        return user.createdAt ?? null;
      case "languages":
        return isAdmin(user.role) ? "" : langsOf(user);
    }
  };
  const sign = sort.direction === "asc" ? 1 : -1;
  return (a: UserRow, b: UserRow) => {
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) return Number(x === null) - Number(y === null);
    return sign * x.localeCompare(y);
  };
}

/** `users`, plus whoever in `grants` is not among them yet, in the order they turned up. */
function withGrantees(users: UserRow[], grants: readonly GrantRow[]): UserRow[] {
  const seen = new Map(users.map((user) => [user.id, user]));
  for (const grant of grants) {
    if (!seen.has(grant.userId)) {
      seen.set(grant.userId, { id: grant.userId, name: grant.name, email: grant.email });
    }
  }
  return seen.size === users.length ? users : [...seen.values()];
}

export default function UserTable({
  users: initialUsers,
  grants: initialGrants,
  viewer,
  currentUserId,
  keyedUserIds,
  q,
  sort,
  page,
}: Props) {
  const { pending, push } = usePendingPush();
  const global = isAdmin(viewer.role);
  // Busy is per row, or "new" for the form that lets somebody in by email.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyed, setKeyed] = useState(() => new Set(keyedUserIds ?? []));
  const [grants, setGrants] = useState(initialGrants);
  // A language admin's list is the grant holders, since they cannot list the users. It only
  // ever grows: somebody let in by email joins it, and somebody whose last grant was just
  // removed stays until the page is reloaded rather than vanishing from under the pointer.
  // A global admin's is the page of users it was given, and the grants of anybody on
  // another page are not a reason to show them on this one.
  const adopt = (current: UserRow[], next: readonly GrantRow[]) =>
    global ? current : withGrantees(current, next);
  const [users, setUsers] = useState(() => adopt(initialUsers, initialGrants));

  const grantsOf = useMemo(() => {
    const byUser = new Map<string, GrantRow[]>();
    for (const grant of grants) {
      const held = byUser.get(grant.userId);
      if (held) held.push(grant);
      else byUser.set(grant.userId, [grant]);
    }
    return byUser;
  }, [grants]);

  const shown = global
    ? users
    : users
        .filter((user) => !q || matches(user, q))
        .sort(
          compareUsers(sort, (user) => {
            const langs = [...new Set((grantsOf.get(user.id) ?? NONE).map((grant) => grant.lang))];
            return langs.length ? langs.sort().join(",") : null;
          }),
        );
  const onSort = (column: UserSort["column"]) => push(usersQuery({ q, sort: nextUserSort(sort, column) }));

  async function sendGrant(busyKey: string, method: "PUT" | "DELETE", target: string, body?: unknown) {
    setPendingId(busyKey);
    setError(null);
    const response = await fetch(target, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    setPendingId(null);
    const data = (await response?.json().catch(() => ({}))) as { grants?: GrantRow[]; error?: string };
    if (!response?.ok || !data.grants) {
      setError(data?.error ?? "That did not work.");
      return false;
    }
    // The route answers with every grant the viewer may see, which is this table's.
    const next = data.grants;
    setGrants(next);
    setUsers((current) => adopt(current, next));
    return true;
  }

  const grant = (busyKey: string, email: string, lang: Lang, capabilities: Capability[]) =>
    sendGrant(busyKey, "PUT", "/api/grants", { email, lang, capabilities });

  const revoke = (userId: string, lang: Lang, capability: Capability) =>
    void sendGrant(userId, "DELETE", `/api/grants?${new URLSearchParams({ userId, lang, capability })}`);

  async function changeRole(userId: string, role: Role) {
    setPendingId(userId);
    setError(null);

    const { error } = await authClient.admin.setRole({ userId, role });

    if (error) {
      setError(error.message ?? "Could not change that role.");
    } else {
      setUsers((current) => current.map((user) => (user.id === userId ? { ...user, role } : user)));
    }
    setPendingId(null);
  }

  /**
   * The account and what is only theirs: sessions, keys, grants and preferences go with it
   * (cascades); what they made, from takes to contributions, stays and loses its author.
   */
  async function removeUser(userId: string) {
    setPendingId(userId);
    setError(null);

    const { error } = await authClient.admin.removeUser({ userId });

    if (error) {
      setError(error.message ?? "Could not delete that user.");
    } else {
      setUsers((current) => current.filter((user) => user.id !== userId));
      setGrants((current) => current.filter((grant) => grant.userId !== userId));
    }
    setPendingId(null);
  }

  /**
   * Take back what a grant spends with.
   *
   * The counterpart of handing out regenerate: someone who leaves should not need psql to be
   * un-keyed. Removing is the whole of the power - an admin can see that a key exists and
   * delete it, never read it.
   */
  async function clearKey(userId: string) {
    setPendingId(userId);
    setError(null);

    const response = await fetch(`/api/profile/api-key?userId=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setError("Could not clear that key.");
    } else {
      setKeyed((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }
    setPendingId(null);
  }

  return (
    <>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      <table
        aria-busy={pending}
        className={cn("w-full text-sm transition-opacity", pending && "opacity-60")}
      >
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <SortHeader column="name" sort={sort} onSort={onSort}>
              Name
            </SortHeader>
            <SortHeader column="email" sort={sort} onSort={onSort}>
              Email
            </SortHeader>
            {global && <th className="py-2 pr-3 font-normal">Role</th>}
            <SortHeader column="languages" sort={sort} onSort={onSort}>
              Languages
            </SortHeader>
            {global && <th className="py-2 pr-3 font-normal">Key</th>}
            {global && (
              <SortHeader column="joined" sort={sort} onSort={onSort}>
                Joined
              </SortHeader>
            )}
            {global && (
              <th className="py-2 font-normal">
                <span className="sr-only">Delete</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <Cell colSpan={3} className="text-muted-foreground">
                {q ? "Nobody matches that." : "Nobody works in your languages yet."}
              </Cell>
            </tr>
          )}
          {shown.map((user) => (
            <tr key={user.id} className="border-b last:border-0">
              <Cell>{user.name}</Cell>
              <Cell className="text-muted-foreground">{user.email}</Cell>
              {global && (
                <Cell fit="control">
                  <RoleCell
                    user={user}
                    self={user.id === currentUserId}
                    busy={pendingId === user.id}
                    onChange={(role) => changeRole(user.id, role)}
                  />
                </Cell>
              )}
              <Cell fit="control">
                {isAdmin(user.role) ? (
                  <span className="text-muted-foreground text-xs">every language, as admin</span>
                ) : (
                  <GrantCell
                    grants={grantsOf.get(user.id) ?? NONE}
                    viewer={viewer}
                    busy={pendingId === user.id}
                    onGrant={(lang, capabilities) => grant(user.id, user.email, lang, capabilities)}
                    onRevoke={(lang, capability) => revoke(user.id, lang, capability)}
                  />
                )}
              </Cell>
              {global && (
                <Cell fit="control" className="whitespace-nowrap">
                  {keyed.has(user.id) ? (
                    <span className="flex items-center gap-2">
                      <span aria-label="key set">✓</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pendingId === user.id}
                        onClick={() => clearKey(user.id)}
                      >
                        Clear
                      </Button>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Cell>
              )}
              {global && (
                <Cell className="text-muted-foreground whitespace-nowrap">
                  {user.createdAt?.slice(0, 10)}
                </Cell>
              )}
              {global && (
                <Cell fit="control" className="whitespace-nowrap">
                  {user.id === currentUserId ? null : (
                    <DeleteUser
                      user={user}
                      busy={pendingId === user.id}
                      onDelete={() => removeUser(user.id)}
                    />
                  )}
                </Cell>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {page && (
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          onPage={(next) => push(usersQuery({ q, sort, page: next }))}
        />
      )}

      {!global && (
        <AddByEmail
          viewer={viewer}
          busy={pendingId === "new"}
          onGrant={(email, lang, capabilities) => grant("new", email, lang, capabilities)}
        />
      )}
    </>
  );
}

/**
 * Asks first, in a popover: deleting an account cannot be undone. Not offered on your own
 * row, for the same reason RoleCell has no select there.
 */
function DeleteUser({ user, busy, onDelete }: { user: UserRow; busy: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Delete ${user.email}`}
          className="text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        <p>
          Delete <span className="font-medium">{user.name || user.email}</span> for good? Their
          grants and keys go with the account; what they made stays, without their name.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Keep
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RoleCell({
  user,
  self,
  busy,
  onChange,
}: {
  user: UserRow;
  self: boolean;
  busy: boolean;
  onChange: (role: Role) => void;
}) {
  const role = user.role ?? "member";
  // No select for yourself: demoting the only admin would lock the last account out of the
  // only page that can undo it, leaving SQL as the only way back in.
  if (self) {
    return (
      <span className="flex items-center gap-2">
        <Badge variant="outline" className="uppercase">
          {role}
        </Badge>
        <span className="text-muted-foreground text-xs">you</span>
      </span>
    );
  }
  return (
    <Select value={role} disabled={busy} onValueChange={(value) => onChange(value as Role)}>
      <SelectTrigger className="w-32" aria-label={`Role for ${user.email}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Letting somebody new into a language, for a language admin, who cannot see the users who
 * hold nothing there yet. By email: an address is what a translator gives somebody when
 * asking to be let in.
 */
function AddByEmail({
  viewer,
  busy,
  onGrant,
}: {
  viewer: Viewer;
  busy: boolean;
  onGrant: (email: string, lang: Lang, capabilities: Capability[]) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  return (
    <div className="mt-4">
      <GrantPicker
        offer={(lang) => (canGrant(viewer, lang) ? CAPABILITIES : [])}
        busy={busy}
        onPick={(lang, capabilities) =>
          void onGrant(email, lang, capabilities).then((ok) => {
            if (ok) setEmail("");
          })
        }
      >
        <Input
          type="email"
          required
          placeholder="their registered email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-64"
        />
      </GrantPicker>
    </div>
  );
}
