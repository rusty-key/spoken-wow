import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The two widths a page's content comes in. Nothing above them caps the page -- not <main>,
 * not the layout -- so every block says which it is.
 *
 * Contained: the reading column, centred and capped. Headings, prose, forms, search bars and
 * the player bar, which line up with it. The site header does not: it takes the front page's
 * 1200px `.bn-wrap`, so the bar stays put between the front page and the rest of the site.
 *
 * Wide: the full window less the same gutter. For the tables -- the explorers' lines and the
 * contributor and admin lists -- whose columns are worth every pixel a wide screen has. A rule
 * above and below, edge to edge, marks where the column gives way to the table and back.
 */
export function Contained({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto max-w-6xl px-5", className)} {...props} />;
}

export function Wide({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("my-3 border-y px-5 py-3", className)} {...props} />;
}
