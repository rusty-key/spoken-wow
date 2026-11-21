import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A Backstage page: the `.bs` scope (backstage.css), a title with a line under it saying what the
 * page is for, and the page's own content.
 *
 * A page sits in the header's 1200px `.bn-wrap`, so title and logo line up. `width="wide"` gives
 * the whole page a 1480px column instead, for lists whose columns want the room.
 */
export default function BackstagePage({
  title,
  description,
  actions,
  width = "contained",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Controls beside the title, such as a page-wide button. */
  actions?: ReactNode;
  width?: "contained" | "wide";
  children: ReactNode;
}) {
  return (
    <main className="bs pb-24">
      <div className={cn(width === "contained" ? "bn-wrap" : "bs-wide")}>
        <div className="bs-head">
          <div className="min-w-0">
            <h1 className="bs-title">{title}</h1>
            {description ? <p className="bs-lede">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </main>
  );
}
