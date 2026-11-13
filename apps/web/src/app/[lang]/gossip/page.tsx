import { redirect } from "next/navigation";

import { pageLang } from "@/lib/lang-server";
import { queryOf } from "@/lib/contributions/query";
import { localeHref } from "@/lib/lang";

/** Gossip is a source in the quests explorer; an old link opens it narrowed to gossip. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await pageLang(params);
  const query = queryOf(await searchParams);
  query.set("source", "gossip");
  redirect(localeHref(lang, `/quests?${query}`));
}
