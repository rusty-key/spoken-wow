import { pageLang } from "@/lib/lang-server";
import { withLang } from "@/lib/lang";
import type { Metadata } from "next";
import Link from "@/components/LocaleLink";
import { notFound } from "next/navigation";

import ReportForm from "@/components/ReportForm";
import { audioRelPath } from "@/lib/books/audio";
import { isCorpusEmpty, loadContext, pageById } from "@/lib/books/catalogue";
import { Contained } from "@/components/Width";

/**
 * One page of one book, and the form to complain about it.
 *
 * Where SpokenBooks' Report button sends people. The client cannot open a URL or post
 * anywhere, so what the addon can offer is an address to copy, and this is the page at the
 * end of it: the words they were just reading, the narration they were just hearing, and the
 * form already pointed at the right line -- which is the whole saving over telling them to
 * find it among 1,191 pages in the explorer.
 *
 * Deliberately not the explorer, for the reason the zones and quests landing pages are not
 * either. Someone arriving from the game is a player, not a collaborator; flags, takes,
 * staleness and the regenerate controls are answers to questions they did not ask.
 *
 * The address is /books/r/{pageTextID} -- the page id and nothing else -- because the addon
 * can build it from what it already has, with no per-page table to ship and nothing to
 * escape. docs/readables/AGENTS.md freezes that id, which is what makes the address safe to bake
 * into a release. See SpokenBooks' ReportURL.
 */
type Params = { lang: string; pageId: string };

async function resolve(params: Promise<Params>) {
  const lang = await pageLang(params);
  const { pageId } = await params;
  try {
    return await pageById(Number(pageId), lang);
  } catch (error) {
    // An unseeded corpus names no pages, so no address resolves to one. What a player
    // arriving from the game should see is the same page an unknown id gives them.
    if (isCorpusEmpty(error)) return undefined;
    throw error;
  }
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const page = await resolve(params);
  // notFound() belongs in the page, not here; this just declines to name a title.
  if (!page) return {};
  return {
    title: `${page.title} · Spoken`,
    description: `Report a problem with the text or narration of ${page.title}.`,
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const lang = await pageLang(params);
  const page = await resolve(params);
  if (!page) notFound();

  // The current take is the only thing here that is not derivable from the corpus row, and it
  // answers one question: is there narration to listen to before complaining about it.
  const take = (await loadContext(lang)).takes.get(page.id);

  return (
    <main className="pt-8 pb-24">
      <Contained>
        <article className="max-w-2xl">
          <h1 className="text-xl font-semibold">{page.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {/* Only where there is more than one: "page 1 of 1" is noise on a letter, which is
                most of this corpus. The addon's queue label makes the same call. */}
            {page.pageCount > 1 ? `Page ${page.pageNumber} of ${page.pageCount}` : "One page"}
          </p>

          {take ? (
            // The native control rather than the explorer's Player: that one carries a rate
            // selector and keyboard wiring built for somebody working through a list. Here
            // there is one clip and one reason to play it.
            <audio
              controls
              preload="metadata"
              className="mt-4 w-full"
              // The take version busts the browser cache after a regeneration; without it
              // somebody sent back to check a fix would hear the clip they complained about.
              src={withLang(lang, `/api/books/audio/${audioRelPath(page.file)}?v=${take.version}`)}
            />
          ) : (
            <p className="text-muted-foreground mt-4 text-sm">
              {/* The 88 unvoiceable pages are not a gap anybody can fix, and saying so here
                  stops a report that no regeneration could answer. */}
              {page.generatable
                ? "This page has no narration yet."
                : `This page is not narrated: ${page.skipReason ?? "there is nothing to read"}.`}
            </p>
          )}

          <p className="mt-5 whitespace-pre-line">{page.text}</p>

          <section className="bg-muted mt-8 rounded-lg border p-4">
            <h2 className="font-medium">Report a problem</h2>
            <p className="text-muted-foreground mt-1 mb-3 text-xs">
              A bad reading, a mispronounced name, or narration that does not match the page.
              Nothing is required but the description.
            </p>
            {/* The target is the page id, which is what the addon put in the address and what
                the endpoint resolves; the lineId is sent for the endpoint to ignore, exactly as
                the zones form does. */}
            <ReportForm source="books" target={String(page.pageId)} lineId={page.id} />
          </section>

          <footer className="text-muted-foreground mt-8 text-sm">
            <Link href={`/books?book=${page.bookId}`} className="hover:text-foreground">
              Browse every page of {page.title}
            </Link>
            <p className="mt-2 text-xs">Text from the game, extracted from the world database.</p>
          </footer>
        </article>
      </Contained>
    </main>
  );
}
