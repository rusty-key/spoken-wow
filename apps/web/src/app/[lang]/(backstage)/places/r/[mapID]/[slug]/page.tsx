import { pageLang, readingLang } from "@/lib/lang-server";
import { withLang } from "@/lib/lang";
import type { Metadata } from "next";
import Link from "@/components/LocaleLink";
import { notFound } from "next/navigation";

import ReportForm from "@/components/ReportForm";
import { packReleases } from "@/lib/releases/store";
import ListenFirst from "@/components/reports/ListenFirst";
import { audioRelPath } from "@/lib/places/audio";
import { isCorpusEmpty, loadContext, teamLineByPath } from "@/lib/places/catalogue";
import { Contained } from "@/components/Width";
import { fill } from "@/lib/site-text/format";
import { uiText } from "@/lib/ui-text";

/**
 * One zone line, and the form to complain about it.
 *
 * Where the addon's Report button sends people. The client cannot open a URL or post
 * anywhere, so what it can offer is an address to copy, and this is the page at the end of
 * it: the line they were just reading, the narration they were just hearing, and the form,
 * already pointed at the right line -- which is the whole saving over telling them to go
 * and find it among 1,353 rows in the explorer.
 *
 * Deliberately not the explorer, for the reason the quests landing page is not either.
 * Someone arriving from the game is a player, not a collaborator; flags, takes, staleness
 * and the regenerate controls are answers to questions they did not ask.
 *
 * The address is /places/r/{mapID}/{slug} -- the same path the line's audio file uses --
 * because the addon can build it from what it already has, with no per-line table and
 * nothing to escape. See SpokenPlaces:ReportURL. Builds already in players' hands point at
 * lore.rusty.one/{lang}/r/... and lore.rusty.one/r/...; both are redirected here.
 */
type Params = { lang: string; mapID: string; slug: string };

async function resolve(params: Promise<Params>) {
  const lang = await pageLang(params);
  const { mapID, slug } = await params;
  try {
    return await teamLineByPath(Number(mapID), slug, lang);
  } catch (error) {
    // An unseeded corpus names no lines, so no address resolves to one. The page a player
    // arriving from the game should see is the same one an unknown place gives them.
    if (isCorpusEmpty(error)) return undefined;
    throw error;
  }
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
  // notFound() belongs in the page, not here; this just declines to name a title.
  if (!entry) return {};
  const t = await words(params);
  return {
    title: `${entry.name} · Spoken`,
    description: fill(t.places.description, { name: entry.name }),
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const lang = await pageLang(params);
  const dictionary = await uiText(await readingLang(lang));
  const t = dictionary.reports.landing;
  const row = dictionary.catalogue.row;
  const entry = await resolve(params);
  if (!entry) notFound();

  // The current take is the only thing here that is not derivable from committed files,
  // and it answers one question: is there narration to listen to before complaining about
  // it.
  const [context, releases] = await Promise.all([loadContext(lang), packReleases("places", lang)]);
  const take = context.takes.get(entry.id);

  return (
    <main className="pt-8 pb-24">
      <Contained>
        <article className="max-w-2xl">
          <h1 className="text-xl font-semibold">{entry.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {entry.kind === "subzone" ? fill(t.places.inZone, { zone: entry.zoneName }) : t.places.zoneLore}
          </p>

          {take ? <ListenFirst className="mt-4" source="places" recordedAt={take.generatedAt} releases={releases} /> : null}

          {take ? (
            // The native control rather than the explorer's Player: that one carries a rate
            // selector and keyboard wiring built for somebody working through a list. Here
            // there is one clip and one reason to play it.
            <audio
              controls
              preload="metadata"
              className="mt-4 w-full"
              // The take version busts the browser cache after a regeneration; without it
              // someone sent back to check a fix would hear the clip they complained about.
              src={withLang(lang, `/api/places/audio/${audioRelPath(entry.file)}?v=${take.version}`)}
            />
          ) : (
            <p className="text-muted-foreground mt-4 text-sm">{t.places.noNarration}</p>
          )}

          {entry.full ? (
            <>
              <p className="mt-5 whitespace-pre-line">{entry.full}</p>
              {/* Under the original, which is what the game shows, and only while the live take speaks it:
                  until then the override is the team's work in progress and the narration says the original. */}
              {entry.override && take?.textHash === entry.hash && (
                <p className="mt-2 border-l-2 border-sky-400/60 pl-2 whitespace-pre-line" title={t.overrideTitle}>
                  {entry.override.text}
                </p>
              )}
            </>
          ) : (
            // Said plainly rather than left as an empty gap, because somebody arriving from
            // the game is here to report a problem and "there is no text yet" is the answer
            // to the one they are about to file.
            <p className="text-muted-foreground mt-5 italic">{t.places.noLore}</p>
          )}

          <section className="bg-muted mt-8 rounded-lg border p-4">
            <h2 className="font-medium">{row.report}</h2>
            <p className="text-muted-foreground mt-1 mb-3 text-xs">{t.places.lede}</p>
            <ReportForm source="places" target={entry.file} lineId={entry.id} fromGame />
          </section>

          <footer className="text-muted-foreground mt-8 text-sm">
            <Link href={`/places?zone=${entry.mapID}`} className="hover:text-foreground">
              {fill(t.places.browse, { zone: entry.zoneName })}
            </Link>
            <p className="mt-2 text-xs">
              {t.places.loreBefore}
              {entry.source ? <a href={entry.source}>warcraft.wiki.gg</a> : "warcraft.wiki.gg"}
              {t.places.loreAfter}
            </p>
          </footer>
        </article>
      </Contained>
    </main>
  );
}
