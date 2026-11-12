"use client";

import { useMemo, useState } from "react";

import GrantCell from "@/components/GrantCell";
import Cell from "@/components/Cell";
import Pagination from "@/components/Pagination";
import SortHeader from "@/components/SortHeader";
import { usePendingPush } from "@/components/usePendingPush";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { giveGrants, takeGrant } from "@/lib/grants/client";
import type { Lang } from "@/lib/lang";
import { nextUserSort, usersQuery, type UserSort } from "@/lib/users/sort";
import { cn } from "@/lib/utils";
import {
  isAdmin,
  isRole,
  ROLES,
  ROLE_LABELS,
  type Capability,
  type Role,
} from "@/lib/permissions";

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role?: string | null | undefined;
  createdAt?: string;
};

const NONE: readonly GrantRow[] = [];

type Props = {
  users: UserRow[];
  /** Every grant on the site. */
  grants: GrantRow[];
  /** The signed-in user, whose own role is deliberately not editable here. */
  currentUserId: string;
  /** Who holds a key. Presence only - no value crosses this boundary. */
  keyedUserIds: string[];
  /** The search, which `users` already match. */
  q: string;
  /** The order `users` already come in. */
  sort: UserSort;
  page: { page: number; pageCount: number };
};

export default function UserTable({
  users: initialUsers,
  grants: initialGrants,
  currentUserId,
  keyedUserIds,
  q,
  sort,
  page,
}: Props) {
  const { pending, push } = usePendingPush();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyed, setKeyed] = useState(() => new Set(keyedUserIds));
  const [grants, setGrants] = useState(initialGrants);
  // The page of users it was given: the grants of anybody on another page are not a reason to
  // show them on this one.
  const [users, setUsers] = useState(initialUsers);

  const grantsOf = useMemo(() => {
    const byUser = new Map<string, GrantRow[]>();
    for (const grant of grants) {
      const held = byUser.get(grant.userId);
      if (held) held.push(grant);
      else byUser.set(grant.userId, [grant]);
    }
    return byUser;
  }, [grants]);

  const onSort = (column: UserSort["column"]) => push(usersQuery({ q, sort: nextUserSort(sort, column) }));

  async function saving(userId: string, send: () => ReturnType<typeof takeGrant>) {
    setPendingId(userId);
    setError(null);
    const answer = await send();
    setPendingId(null);
    if (!answer.grants) {
      setError(answer.error ?? "That did not work.");
      return false;
    }
    // The route answers with every grant the viewer may see, which is this table's.
    setGrants(answer.grants);
    return true;
  }

  const grant = (userId: string, email: string, lang: Lang, capabilities: Capability[]) =>
    saving(userId, () => giveGrants(email, lang, capabilities));

  const revoke = (userId: string, lang: Lang, capability: Capability) =>
    void saving(userId, () => takeGrant(userId, lang, capability));

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
            <th className="py-2 pr-3 font-normal">Role</th>
            <SortHeader column="languages" sort={sort} onSort={onSort}>
              Languages
            </SortHeader>
            <th className="py-2 pr-3 font-normal">Key</th>
            <SortHeader column="joined" sort={sort} onSort={onSort}>
              Joined
            </SortHeader>
            <th className="py-2 font-normal">
              <span className="sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <Cell colSpan={7} className="text-muted-foreground">
                {q ? "Nobody matches that." : "Nobody has registered yet."}
              </Cell>
            </tr>
          )}
          {users.map((user) => (
            <tr key={user.id} className="border-b last:border-0">
              <Cell>{user.name}</Cell>
              <Cell className="text-muted-foreground">{user.email}</Cell>
              <Cell fit="control">
                <RoleCell
                  user={user}
                  self={user.id === currentUserId}
                  busy={pendingId === user.id}
                  onChange={(role) => changeRole(user.id, role)}
                />
              </Cell>
              <Cell fit="control">
                {isAdmin(user.role) ? (
                  <span className="text-muted-foreground text-xs">every language, as admin</span>
                ) : (
                  <GrantCell
                    grants={grantsOf.get(user.id) ?? NONE}
                    busy={pendingId === user.id}
                    onGrant={(lang, capabilities) => grant(user.id, user.email, lang, capabilities)}
                    onRevoke={(lang, capability) => revoke(user.id, lang, capability)}
                  />
                )}
              </Cell>
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
              <Cell className="text-muted-foreground whitespace-nowrap">{user.createdAt?.slice(0, 10)}</Cell>
              <Cell fit="control" className="whitespace-nowrap">
                {user.id === currentUserId ? null : (
                  <DeleteUser user={user} busy={pendingId === user.id} onDelete={() => removeUser(user.id)} />
                )}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>

      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        onPage={(next) => push(usersQuery({ q, sort, page: next }))}
      />
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
          {isRole(role) ? ROLE_LABELS[role] : role}
        </Badge>
        <span className="text-muted-foreground text-xs">you</span>
      </span>
    );
  }
  return (
    <Select value={role} disabled={busy} onValueChange={(value) => onChange(value as Role)}>
      <SelectTrigger className="w-36" aria-label={`Role for ${user.email}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((option) => (
          <SelectItem key={option} value={option}>
            {ROLE_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
