import { redirect } from "next/navigation";

import { pageLang } from "@/lib/lang-server";
import { queryOf } from "@/lib/contributions/query";
import { localeHref } from "@/lib/lang";
import { isSource } from "@/lib/sections";

/** Quests is the section most reports are for; an old `?source=` link lands on its own tab. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await pageLang(params);
  const query = queryOf(await searchParams);
  const source = query.get("source");
  query.delete("source");
  const section = isSource(source) ? source : "quests";
  redirect(localeHref(lang, `/reports/${section}${query.size ? `?${query}` : ""}`));
}
