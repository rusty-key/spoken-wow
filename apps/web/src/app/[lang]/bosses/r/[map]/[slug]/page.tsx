import { pageLang } from "@/lib/lang-server";
import { withLang } from "@/lib/lang";
import type { Metadata } from "next";
import Link from "@/components/LocaleLink";
import { notFound } from "next/navigation";

import ReportForm from "@/components/ReportForm";
import ListenFirst from "@/components/reports/ListenFirst";
import { audioRelPath } from "@/lib/bosses/audio";
import { lineByPath, loadContext } from "@/lib/bosses/catalogue";
import { bossesHref } from "@/lib/links";
import { Contained } from "@/components/Width";

/**
 * One boss's story, and the form to complain about it. A player arriving from the game wants
 * the story, its narration and the form, not the explorer's controls.
 *
 * The address is /bosses/r/{map}/{slug}, the path the boss's audio file uses, so the addon can
 * build it from what it already has.
 */
type Params = { lang: string; map: string; slug: string };

async function resolve(params: Promise<Params>) {
  const lang = await pageLang(params);
  const { map, slug } = await params;
  return lineByPath(Number(map), slug, lang);
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const entry = await resolve(params);
  if (!entry) return {};
  return {
    title: `${entry.name} · Spoken`,
    description: `Report a problem with the story or narration for ${entry.name}.`,
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const lang = await pageLang(params);
  const entry = await resolve(params);
  if (!entry) notFound();

  // A take left behind on a story this language no longer has would play text the page does
  // not show, so with no story there is nothing to listen to.
  const take = entry.text === null ? undefined : (await loadContext(lang)).takes.get(entry.id);

  return (
    <main className="pt-8 pb-24">
      <Contained>
        <article className="max-w-2xl">
          <h1 className="text-xl font-semibold">{entry.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">In {entry.instanceName}</p>

          {take ? <ListenFirst className="mt-4" /> : null}

          {take ? (
            <audio
              controls
              preload="metadata"
              className="mt-4 w-full"
              // The take version busts the browser cache after a regeneration; without it
              // someone sent back to check a fix would hear the clip they complained about.
              src={withLang(lang, `/api/bosses/audio/${audioRelPath(entry.file)}?v=${take.version}`)}
            />
          ) : (
            <p className="text-muted-foreground mt-4 text-sm">This story has no narration yet.</p>
          )}

          {entry.text ? (
            <p className="mt-5 whitespace-pre-line">{entry.text}</p>
          ) : (
            <p className="text-muted-foreground mt-5 italic">No story in this language yet.</p>
          )}

          <section className="bg-muted mt-8 rounded-lg border p-4">
            <h2 className="font-medium">Report a problem</h2>
            <p className="text-muted-foreground mt-1 mb-3 text-xs">
              A wrong story, a mispronunciation, or narration that does not play. Nothing is
              required but the description.
            </p>
            <ReportForm source="bosses" target={entry.file} lineId={entry.id} fromGame />
          </section>

          <footer className="text-muted-foreground mt-8 text-sm">
            <Link href={bossesHref({ mapID: entry.map })} className="hover:text-foreground">
              Browse every boss in {entry.instanceName}
            </Link>
            {entry.source ? (
              <p className="mt-2 text-xs">
                Story drawn in part from <a href={entry.source}>warcraft.wiki.gg</a> (CC BY-SA 4.0)
              </p>
            ) : null}
          </footer>
        </article>
      </Contained>
    </main>
  );
}
