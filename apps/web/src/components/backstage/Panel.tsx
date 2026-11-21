import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PanelTone = "good" | "fix" | "drop" | "info" | "neutral";

/**
 * Use `quiet` for work the current reviewer cannot act on.
 */
export default function Panel({
  tone = "neutral",
  icon,
  title,
  count,
  description,
  action,
  quiet = false,
  id,
  children,
}: {
  tone?: PanelTone;
  icon?: ReactNode;
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  action?: ReactNode;
  quiet?: boolean;
  id?: string;
  children?: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("bs-panel", `bs-tone-${tone}`, quiet && "bs-panel-quiet")}>
      <div className="bs-panel-head">
        <div className="bs-panel-title-row">
          {icon ? (
            <span className="bs-panel-icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 id={headingId} className="bs-panel-title">
              {title}
              {count !== undefined ? <span className="bs-count"> · {count}</span> : null}
            </h2>
            {description ? <p className="bs-panel-desc">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children ? <div className="bs-rows">{children}</div> : null}
    </section>
  );
}
