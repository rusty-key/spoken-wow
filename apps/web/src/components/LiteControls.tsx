/**
 * A button and a checkbox for controls repeated on every row of a long table.
 *
 * ui/button and ui/checkbox look the same but cost far more per copy: the button carries about
 * 940 characters of classes, and the checkbox is a Radix component with its own state, context
 * and a hidden input. A hundred rows of those were most of /contributions's HTML and much of
 * the work the browser did on load. These are plain elements with short class strings.
 */
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const BASE =
  "inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap " +
  "hover:bg-muted focus-visible:ring-ring/50 outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50";

/**
 * Tinted so accept and reject can be told apart down a column without reading them. Hover and
 * dark states are spelled out because ui/button's outline variant would otherwise win.
 */
export const ACCEPT_TONE =
  "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-700 " +
  "dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-400";
export const REJECT_TONE =
  "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive " +
  "dark:border-destructive/40 dark:bg-destructive/15 dark:hover:bg-destructive/25";

const VARIANTS = {
  outline: "border-border bg-background border",
  ghost: "",
  accept: ACCEPT_TONE,
  reject: REJECT_TONE,
} as const;

export function LiteButton({
  variant = "outline",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof VARIANTS }) {
  return <button type={type} className={cn(BASE, VARIANTS[variant], className)} {...props} />;
}

export function LiteCheckbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cn("accent-primary dark:scheme-dark size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}
