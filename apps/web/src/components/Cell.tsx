import type { ReactNode, TdHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * A table cell padded for what it holds, so text and controls in one row share a centre line.
 *
 * Every row is 40px at its least: a control cell is a 32px band (h-8, the tallest control a
 * row holds) inside 4px of padding, centring whatever is in it; a text cell is one 20px line
 * inside 10px. Top-aligned, so a cell that wraps grows the row downwards and the first lines
 * still line up.
 */
export default function Cell({
  fit = "text",
  className,
  children,
  ...props
}: {
  /** "control" for selects, buttons and badges; "text" for a plain line. */
  fit?: "text" | "control";
  children?: ReactNode;
} & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("pr-3 align-top last:pr-0", fit === "text" ? "py-2.5" : "py-1", className)} {...props}>
      {fit === "control" ? <div className="flex min-h-8 items-center">{children}</div> : children}
    </td>
  );
}
