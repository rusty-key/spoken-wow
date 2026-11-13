import { redirect } from "next/navigation";

import { pageLang } from "@/lib/lang-server";
import { queryOf } from "@/lib/contributions/query";
import { localeHref } from "@/lib/lang";

/** Quests is the section most contributions are for; old links keep their filters. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await pageLang(params);
  redirect(localeHref(lang, `/contributions/quests?${queryOf(await searchParams)}`));
}
