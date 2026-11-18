import { notFound, redirect } from "next/navigation";

import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";

/**
 * Corrections were a page of their own; they are now a group on the contributions page, in every
 * status tab. An old link opens that page with the same filters, which gates it as before.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; source: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await pageLang(params);
  const source = (await params).source;
  if (source !== "quests" && source !== "readables") notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  const rest = query.toString();
  redirect(localeHref(lang, `/contributions/${source}${rest ? `?${rest}` : ""}#changes`));
}
