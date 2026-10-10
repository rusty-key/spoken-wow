import { redirect } from "next/navigation";

import { localeHref } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";

/** NPCs moved out of Contributions to /npcs; old links land there. */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  redirect(localeHref(await pageLang(params), "/npcs"));
}
