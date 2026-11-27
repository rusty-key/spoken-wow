"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import Link from "@/components/LocaleLink";

const CLOSED_KEY = "spoken.listenBar.closed";

/**
 * Runs as the page is parsed, before it paints: waiting for hydration would show a bar the
 * visitor already closed for a moment on every page.
 */
const HIDE_IF_CLOSED = `try{if(localStorage.getItem(${JSON.stringify(CLOSED_KEY)}))document.currentScript.previousElementSibling.hidden=true}catch(e){}`;

/** The call to vote on designed voices, above every page's bar but the Listen page's own. */
export default function ListenBar({ text, cta, close }: { text: string; cta: string; close: string }) {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage?.getItem(CLOSED_KEY)) setClosed(true);
    } catch {
      // Storage blocked: the bar shows, and closing it lasts for this page.
    }
  }, []);

  function dismiss() {
    setClosed(true);
    try {
      window.localStorage?.setItem(CLOSED_KEY, "1");
    } catch {
      // Storage blocked: closed for this page only.
    }
  }

  return (
    <>
      <div className="listen-bar" hidden={closed} suppressHydrationWarning>
        <span>{text}</span>
        <Link href="/listen">{cta} →</Link>
        <button type="button" className="listen-bar-close" aria-label={close} title={close} onClick={dismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <script dangerouslySetInnerHTML={{ __html: HIDE_IF_CLOSED }} />
    </>
  );
}
