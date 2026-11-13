"use client";

import { usePathname } from "next/navigation";

import { stripLang } from "@/lib/lang";

/** The site's header on every page but the front page, which draws its own. */
export default function SiteHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return stripLang(pathname).path === "/" ? null : children;
}
