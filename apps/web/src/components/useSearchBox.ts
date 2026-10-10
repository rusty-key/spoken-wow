"use client";

import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;

/**
 * A search box whose query lives in the URL and is applied by the server: what is typed is
 * sent once typing pauses, since each send is a whole server render.
 *
 * `sent` is what this box last asked for. A `q` that differs from it came from elsewhere (the
 * back button), and is shown rather than overwritten by the box's older text.
 */
export function useSearchBox(q: string, onSearch: (query: string) => void): [string, (query: string) => void] {
  const [query, setQuery] = useState(q);
  const sent = useRef(q);
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });
  useEffect(() => {
    if (q === sent.current) return;
    sent.current = q;
    setQuery(q);
  }, [q]);
  useEffect(() => {
    if (query.trim() === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = query.trim();
      onSearchRef.current(query);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  return [query, setQuery];
}
