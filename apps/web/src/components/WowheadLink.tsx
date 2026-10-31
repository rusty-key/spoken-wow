"use client";

/**
 * The way out to Wowhead, small enough to sit inside a row's id line.
 *
 * stopPropagation because a row's own click handler toggles it open; the handlers already
 * ignore clicks on an anchor, and this keeps that true if the markup around it changes.
 */
export default function WowheadLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title="Look this up on Wowhead Classic"
      className="hover:text-foreground underline underline-offset-2"
    >
      wh
    </a>
  );
}
