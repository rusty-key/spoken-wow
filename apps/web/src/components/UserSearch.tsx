"use client";

import { usePathname } from "next/navigation";

import { Input } from "@/components/ui/input";
import { usePendingPush } from "@/components/usePendingPush";
import { useSearchBox } from "@/components/useSearchBox";
import { usersQuery, type UserSort } from "@/lib/users/sort";

/**
 * The Users page's search, by part of a name or an email. Outside UserTable, which is
 * remounted for every search and would take the box's focus with it.
 */
export default function UserSearch({ q, sort }: { q: string; sort: UserSort }) {
  const pathname = usePathname();
  const { push } = usePendingPush();
  // A new search starts on its first page.
  const [query, setQuery] = useSearchBox(q, (next) =>
    push(`${pathname}${usersQuery({ q: next.trim(), sort })}`),
  );
  return (
    <Input
      type="search"
      value={query}
      placeholder="Name or email…"
      aria-label="Search users"
      className="mb-4 h-8 w-64 max-w-full"
      onChange={(event) => setQuery(event.target.value)}
    />
  );
}
