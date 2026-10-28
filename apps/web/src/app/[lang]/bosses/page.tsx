import type { Metadata } from "next";

import { Explorer } from "@/components/bosses/Explorer";
import { Contained } from "@/components/Width";
import { bossesFor } from "@/lib/bosses/catalogue";
import { pageLang } from "@/lib/lang-server";

export const metadata: Metadata = { title: "Boss Lore · Spoken" };

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const bosses = bossesFor(lang);

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Boss Lore</h1>
        <p className="mt-1 mb-6 max-w-3xl text-sm text-muted-foreground">
          Stories for dungeon, raid and world bosses. The names follow your selected game
          language; translated story text is shown when it is available.
        </p>
      </Contained>
      <Explorer bosses={bosses} />
    </main>
  );
}
