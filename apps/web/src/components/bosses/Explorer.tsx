"use client";

import { useMemo, useState } from "react";

import type { BossLore } from "@/lib/bosses/catalogue";
import { Contained } from "@/components/Width";

export function Explorer({ bosses }: { bosses: BossLore[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return bosses;
    return bosses.filter((boss) =>
      `${boss.name} ${boss.dungeon} ${boss.story}`.toLocaleLowerCase().includes(needle),
    );
  }, [bosses, query]);

  const groups = useMemo(() => {
    const grouped = new Map<string, BossLore[]>();
    for (const boss of filtered) grouped.set(boss.dungeon, [...(grouped.get(boss.dungeon) ?? []), boss]);
    return [...grouped.entries()];
  }, [filtered]);

  return (
    <Contained>
      <label className="sr-only" htmlFor="boss-search">
        Search boss lore
      </label>
      <input
        id="boss-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search bosses, dungeons or stories"
        className="mb-6 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
      />
      <p className="mb-6 text-sm text-muted-foreground">
        Showing {filtered.length} of {bosses.length} boss stories.
      </p>
      {groups.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">No boss stories match that search.</p>
      ) : (
        <div className="space-y-10">
          {groups.map(([dungeon, entries]) => (
            <section key={dungeon}>
              <h2 className="mb-3 text-lg font-semibold">{dungeon}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {entries.map((boss) => (
                  <article key={boss.id} className="rounded-lg border bg-card p-5 shadow-sm">
                    <h3 className="text-base font-semibold">{boss.name}</h3>
                    {!boss.translated && (
                      <p className="mt-1 text-xs text-muted-foreground">English source text</p>
                    )}
                    <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                      {boss.story}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Contained>
  );
}
