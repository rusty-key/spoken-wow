"use client";

/**
 * What a reported line is and who says it. The quest title opens the explorer on the quest's
 * lines; the NPC's name opens their NPC page, with a search icon beside it for the explorer on
 * their lines. Shared by the triage table and the sort queue.
 */
import { Search } from "lucide-react";

import Link from "@/components/LocaleLink";
import type { Heading } from "@/lib/reports/detail";
import { cn } from "@/lib/utils";

const LINK = "underline-offset-2 hover:underline";

export default function LineHeading({
  detail,
  showNpcPage,
  className,
  asideClassName,
}: {
  detail: Heading;
  /** Whether the viewer may open /npcs, which is the admins' alone. */
  showNpcPage: boolean;
  className?: string;
  asideClassName?: string;
}) {
  const { speaker } = detail;

  return (
    <>
      {speaker && detail.speakerIsHeading ? (
        <Speaker speaker={speaker} admin={showNpcPage} className={cn("font-medium", className)} />
      ) : detail.headingHref ? (
        <Link href={detail.headingHref} className={cn("font-medium", LINK, className)}>
          {detail.heading}
        </Link>
      ) : (
        <span className={cn("font-medium", className)}>{detail.heading}</span>
      )}
      <span className={cn("text-muted-foreground text-xs", asideClassName)}>
        {speaker && !detail.speakerIsHeading ? (
          <>
            <Speaker speaker={speaker} admin={showNpcPage} className="hover:text-foreground" />
            {detail.aside ? " · " : null}
          </>
        ) : null}
        {detail.aside}
      </span>
    </>
  );
}

/**
 * The NPC page 404s for anybody but an admin, so for everyone else the name opens the explorer
 * and there is no icon to repeat it.
 */
function Speaker({
  speaker,
  admin,
  className,
}: {
  speaker: NonNullable<Heading["speaker"]>;
  admin: boolean;
  className?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Link
        href={admin ? speaker.page : speaker.search}
        title={admin ? "Open this NPC on the NPCs page" : `Show ${speaker.name}'s lines`}
        className={cn(LINK, className)}
      >
        {speaker.name}
      </Link>
      {admin ? (
        <Link
          href={speaker.search}
          title={`Show ${speaker.name}'s lines`}
          aria-label={`Show ${speaker.name}'s lines`}
          className="text-muted-foreground hover:text-foreground"
        >
          <Search className="size-3.5" />
        </Link>
      ) : null}
    </span>
  );
}
