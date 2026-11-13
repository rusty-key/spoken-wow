"use client";

import type { ComponentProps } from "react";

/**
 * A link to the page narrowed by one filter. A plain click narrows in place through `onApply`,
 * which also keeps the search box in step; a modified or middle click opens `href` in a new tab
 * or window, as any link would.
 */
export default function FilterLink({
  href,
  onApply,
  ...props
}: Omit<ComponentProps<"a">, "onClick"> & { href: string; onApply: () => void }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onApply();
      }}
      {...props}
    />
  );
}
