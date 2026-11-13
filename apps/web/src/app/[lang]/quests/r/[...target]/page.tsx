/**
 * Where the game's Report button sends a player.
 *
 * Not the explorer: someone arriving from the game is a player, not an editor. They see the
 * line, hear the take that is live, and file a report - nothing else.
 *
 * An address that resolves to nothing still renders the form. "The addon sent me to a page
 * that knows nothing about this quest" is information about the data module, and 404ing it
 * would throw that away.
 *
 * One catch-all segment serves both address shapes, so there is one page rather than two that
 * drift apart.
 */
import { pageLang } from "@/lib/lang-server";
import { withLang } from "@/lib/lang";
import { corpus, isCorpusEmpty } from "@/lib/quests/catalogue";
import type { Metadata } from "next";
import Link from "@/components/LocaleLink";

import ReportForm from "@/components/ReportForm";
import { packReleases } from "@/lib/releases/store";
import ListenFirst from "@/components/reports/ListenFirst";
import { audioRelPath } from "@/lib/audio";
import { formatTarget, parseTarget, resolveTarget } from "@/lib/reports/target";
import { liveTake } from "@/lib/takes/store";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Report a voice line · VoiceOver" };

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; target: string[] }>;
  searchParams: Promise<{ line?: string }>;
}) {
  const lang = await pageLang(params);
  const segments = (await params).target;
  const chosen = (await searchParams).line ?? null;
  const target = parseTarget(segments);

  if (!target) {
    return (
      <main className="pt-6 pb-24">
        <Contained>
          <h1 className="text-xl font-semibold">Report a voice line</h1>
          <p className="text-muted-foreground mt-1 mb-5 text-sm">
            That address is not one this site understands, but you can still tell us about it.
          </p>
          <ReportForm source="quests" target={segments.join("/")} lineId={null} fromGame />
        </Contained>
      </main>
    );
  }

  // Started before the corpus, which it does not wait on.
  const releasing = packReleases("quests", lang);
  // A language with no lines yet resolves nothing, the same as an address naming nothing:
  // the reporter still gets the form.
  const lines = await corpus(lang).then(
    (lines) => resolveTarget(target, lines),
    (error) => {
      if (isCorpusEmpty(error)) return [];
      throw error;
    },
  );
  // One per lineId, which is what the reporter chooses between and what the report stores. A
  // follow-up line said after several of the speaker's quests is a corpus row per quest with
  // one id and one file, and listing each would offer the same words twice (and give React
  // two children with one key).
  const choices = [...new Map(lines.map((candidate) => [candidate.lineId, candidate])).values()];
  // One candidate needs no choosing; several mean the reporter picked one from the list below.
  const line =
    choices.find((candidate) => candidate.lineId === chosen) ??
    (choices.length === 1 ? choices[0] : null);
  // Which take is live, to bust the audio cache: without it someone returning to hear a fix
  // hears the browser's copy of the very clip they complained about, and reports it again.
  const [take, releases] = await Promise.all([
    line ? liveTake("quests", audioRelPath(line), lang) : null,
    releasing,
  ]);
  const version = take?.version ?? null;

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">Report a voice line</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          You came here from the game. Tell us what sounded wrong and someone will listen to it.
        </p>

        {take ? <ListenFirst className="mb-4" source="quests" recordedAt={take.createdAt} releases={releases} /> : null}

        {line ? (
          <section className="mb-6 rounded border p-4">
            <h2 className="font-medium">{line.questTitle ?? line.npcName}</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {line.npcName} · {line.voice}
            </p>
            <p className="mt-2 text-sm whitespace-pre-wrap">{line.text}</p>
            {/* No live take is the line a player heard in the fallback language and reported as
                missing in this one: the audio route has nothing to serve, so say so. */}
            {version === null ? (
              <p className="text-muted-foreground mt-3 text-sm">
                This line has no recording in this language yet.
              </p>
            ) : (
              <audio
                controls
                className="mt-3 w-full"
                src={withLang(lang, `/api/quests/audio/${audioRelPath(line)}?v=${version}`)}
              />
            )}
          </section>
        ) : null}

        {choices.length > 1 && !line ? (
          <section className="mb-6 rounded border p-4">
            <h2 className="font-medium">{choices[0].npcName}</h2>
            <p className="text-muted-foreground mt-1 mb-2 text-sm">
              This character has more than one line. Which one sounded wrong?
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {choices.map((candidate) => (
                <li key={candidate.lineId}>
                  <Link
                    href={`/quests/r/${formatTarget(target)}?line=${encodeURIComponent(candidate.lineId)}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {candidate.text.slice(0, 120)}
                    {candidate.text.length > 120 ? "…" : ""}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {lines.length === 0 ? (
          <p className="text-muted-foreground mb-6 text-sm">
            Nothing in the corpus matches that address. File the report anyway — an address that
            resolves to nothing is worth knowing about.
          </p>
        ) : null}

        <ReportForm source="quests" target={formatTarget(target)} lineId={line?.lineId ?? null} fromGame />
      </Contained>
    </main>
  );
}
