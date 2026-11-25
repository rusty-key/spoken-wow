import { pageLang, readingLang } from "@/lib/lang-server";
import { withLang } from "@/lib/lang";
import type { Metadata } from "next";
import Link from "@/components/LocaleLink";
import { notFound } from "next/navigation";

import ReportForm from "@/components/ReportForm";
import ListenFirst from "@/components/reports/ListenFirst";
import { audioRelPath } from "@/lib/bosses/audio";
import { loadContext, teamLineByPath } from "@/lib/bosses/catalogue";
import { bossesHref } from "@/lib/links";
import { Contained } from "@/components/Width";
import { fill } from "@/lib/site-text/format";
import { uiText } from "@/lib/ui-text";

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
  return teamLineByPath(Number(map), slug, lang);
}

async function words(params: Promise<Params>) {
  return (await uiText(await readingLang(await pageLang(params)))).reports.landing;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const entry = await resolve(params);
  if (!entry) return {};
  const t = await words(params);
  return {
    title: `${entry.name} · Spoken`,
    description: fill(t.bosses.description, { name: entry.name }),
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const lang = await pageLang(params);
  const dictionary = await uiText(await readingLang(lang));
  const t = dictionary.reports.landing;
  const row = dictionary.catalogue.row;
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
          <p className="text-muted-foreground mt-1 text-sm">{fill(t.bosses.inInstance, { instance: entry.instanceName })}</p>

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
            <p className="text-muted-foreground mt-4 text-sm">{t.bosses.noNarration}</p>
          )}

          {entry.text ? (
            <>
              <p className="mt-5 whitespace-pre-line">{entry.text}</p>
              {/* Under the original, which is what the game shows, and only while the live take speaks it:
                  until then the override is the team's work in progress and the narration says the original. */}
              {entry.override && take?.textHash === entry.hash && (
                <p className="mt-2 border-l-2 border-sky-400/60 pl-2 whitespace-pre-line" title={t.overrideTitle}>
                  {entry.override.text}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground mt-5 italic">{row.noStory}</p>
          )}

          <section className="bg-muted mt-8 rounded-lg border p-4">
            <h2 className="font-medium">{row.report}</h2>
            <p className="text-muted-foreground mt-1 mb-3 text-xs">{t.bosses.lede}</p>
            <ReportForm source="bosses" target={entry.file} lineId={entry.id} fromGame />
          </section>

          <footer className="text-muted-foreground mt-8 text-sm">
            <Link href={bossesHref({ mapID: entry.map })} className="hover:text-foreground">
              {fill(t.bosses.browse, { instance: entry.instanceName })}
            </Link>
            {entry.source ? (
              <p className="mt-2 text-xs">
                {t.bosses.sourceBefore}
                <a href={entry.source}>warcraft.wiki.gg</a>
                {t.bosses.sourceAfter}
              </p>
            ) : null}
          </footer>
        </article>
      </Contained>
    </main>
  );
}
