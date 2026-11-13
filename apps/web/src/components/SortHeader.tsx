/**
 * A column header that orders a table: a click sorts on it, a second click flips it. The
 * column in force shows its direction; the others show a faint both-ways arrow, so which
 * headers can be clicked is visible without hovering each one.
 */
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export default function SortHeader<C extends string>({
  column,
  sort,
  onSort,
  children,
}: {
  column: C;
  sort: { column: C; direction: "asc" | "desc" };
  onSort: (column: C) => void;
  children: ReactNode;
}) {
  const active = sort.column === column;
  const Icon = !active ? ArrowUpDownIcon : sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <th
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="border-b py-2 pr-3 font-normal"
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 transition-colors",
          active && "text-foreground font-medium",
        )}
      >
        {children}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}
