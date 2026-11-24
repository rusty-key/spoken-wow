"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { fill } from "@/lib/site-text/format";

type Props = {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
};

/**
 * Prev/next only.
 *
 * There are 351 pages of the full corpus, so a numbered pager would be a row of ellipses,
 * and jumping to page 200 of an alphabetical list is not a thing anyone wants. Narrowing the
 * filters is the way to reach the far end, and that is what the bar above is for.
 */
export default function Pagination({ page, pageCount, onPage }: Props) {
  const t = useUiText().catalogue;
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 py-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft /> {t.previous}
      </Button>
      <span className="text-muted-foreground text-sm tabular-nums">
        {fill(t.pageOf, { page: page.toLocaleString(), count: pageCount.toLocaleString() })}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        {t.next} <ChevronRight />
      </Button>
    </div>
  );
}
