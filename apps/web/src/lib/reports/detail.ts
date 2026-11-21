/**
 * One line of any section, as the triage table shows it.
 *
 * CLIENT-SAFE ON PURPOSE, like lib/places/filters.ts: the expanded row runs in the browser,
 * and every module that can answer "what is this line?" on the server reaches the corpus,
 * the database or the filesystem. Types cross freely; runtime code does not, so the three
 * ResultLine shapes are narrowed here from what the search endpoints already return.
 *
 * The three agree on nothing - quests has `lineId`, `audioPath` and `hasAudio`, places and
 * readables have `id`, `file` and a `state` - so the reading is done once, here, rather than in
 * a row that would silently render an empty panel if it reached for the wrong pair.
 */
import { BASE_LANG, withLang, type Lang } from "@/lib/lang";
import { noApiKeyMessage } from "@/lib/no-api-key";
import type { ResultLine as BookLine } from "@/lib/readables/search";
import type { ResultLine as BossLine } from "@/lib/bosses/search";
import type { CorpusLine } from "@/lib/corpus";
import type { ResultLine as QuestLine } from "@/lib/search";
import type { ResultLine as ZoneLine } from "@/lib/places/search";

import { npcHref, npcPageHref, questsHref } from "@/lib/links";

import { targetForLine } from "./line-target";
import type { Source } from "@/lib/sections";

/** Whichever shape the section's search endpoint answered with. */
export type SourceLine = QuestLine | ZoneLine | BookLine | BossLine;

/** What a line is and who says it: what LineHeading draws, for a line or for a speaker alone. */
export type Heading = {
  /** What the line is called: the quest, the subzone, the book. */
  heading: string;
  /** The explorer, narrowed to the heading's quest. Null where the heading is no quest. */
  headingHref: string | null;
  /**
   * Who says it, quests only, with their NPC page and the explorer narrowed to their lines.
   * A line with no quest is headed by its speaker, who is then not named a second time.
   */
  speaker: { name: string; page: string; search: string } | null;
  speakerIsHeading: boolean;
  /** Where it sits, and for quests what picked its voice. */
  aside: string;
};

export type LineDetail = Heading & {
  /** The live take was made from text that has since changed. */
  stale: boolean;
  /** Null where the line has no text in the language: a boss with no story yet. */
  text: string | null;
  /** The audio route, or null where there is no take to play. */
  audioSrc: string | null;
  /** The id this section's regenerate endpoint takes. */
  lineId: string;
};

/**
 * The address a report about this line travels on, or null where the line has none.
 *
 * One per section, because the three address lines by different frozen rules and each one
 * is what its /r/ landing page already resolves: a quests address is the one the addon
 * builds out of a quest id or a unit GUID, a places address is the line's own audio path --
 * which is what /places/r/{mapID}/{slug} is, as a bosses one is of /bosses/r/ -- and a
 * readables address is the page id and nothing else, because that is all the addon has to
 * build a link from.
 *
 * Only quests can answer null. Its addresses are built from what a client can see, and a
 * line neither a quest nor an NPC address can name would arrive in triage unresolvable.
 */
const TARGETS: Record<Source, (line: SourceLine) => string | null> = {
  quests: (line) => targetForLine(line as QuestLine),
  places: (line) => (line as ZoneLine).file,
  readables: (line) => (line as BookLine).key,
  bosses: (line) => (line as BossLine).file,
};

/**
 * A total Record rather than an if-chain whose last branch is readables by default: a fourth
 * section is then a type error here, not a report quietly addressed like a book page.
 */
export function reportTargetOf(source: Source, line: SourceLine): string | null {
  return TARGETS[source](line);
}

/** The section's search, narrowed to the one line a report is about. */
export function searchPath(source: Source, lineId: string, lang: Lang = BASE_LANG): string {
  return withLang(lang, `/api/${source}/search?${new URLSearchParams({ line: lineId, limit: "1" })}`);
}

export function regeneratePath(source: Source, lang: Lang = BASE_LANG): string {
  return withLang(lang, `/api/${source}/regenerate`);
}

/**
 * Cuts a new take of one line, and says which version it wrote or why it could not.
 *
 * "You have the role but no key on file" is one page away from fixed, so it comes back in
 * those words rather than reading as a failure of the line.
 */
export async function regenerateLine(
  source: Source,
  lineId: string,
  lang: Lang = BASE_LANG,
): Promise<{ version: number } | { error: string }> {
  const response = await fetch(regeneratePath(source, lang), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineId }),
  }).catch(() => null);
  if (!response) return { error: "the request did not go through" };

  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    version?: number;
    error?: string;
    code?: string;
  };
  const noKey = noApiKeyMessage(response.status, body);
  if (noKey) return { error: noKey };
  if (!response.ok || !body.ok || body.version === undefined) {
    return { error: body.error ?? `failed (${response.status})` };
  }
  return { version: body.version };
}

const FILES: Record<Source, (line: SourceLine) => string> = {
  quests: (line) => (line as QuestLine).audioPath,
  places: (line) => (line as ZoneLine).file,
  readables: (line) => (line as BookLine).file,
  bosses: (line) => (line as BossLine).file,
};

/** The store-relative file a line's takes belong to, as /api/takes addresses it. */
export function fileOf(source: Source, line: SourceLine): string {
  return FILES[source](line);
}

/**
 * `version` is the take a regeneration wrote in this session, appended as a cache buster.
 * A regenerated line keeps its path - the addon resolves sounds by filename, so it cannot
 * change - and without this the browser replays the take that was just overwritten.
 */
export function detailOf(
  source: Source,
  line: SourceLine,
  version?: number,
  lang: Lang = BASE_LANG,
): LineDetail {
  if (source === "quests") return questDetail(line as QuestLine, version, lang);
  if (source === "places") return zoneDetail(line as ZoneLine, version, lang);
  if (source === "bosses") return bossDetail(line as BossLine, version, lang);
  return bookDetail(line as BookLine, version, lang);
}

/** The live take was made from text that has since changed. */
export function isStale(source: Source, line: SourceLine): boolean {
  return source === "quests" ? (line as QuestLine).stale : (line as ZoneLine | BookLine | BossLine).state === "stale";
}

function audio(source: Source, path: string, version: number | undefined, lang: Lang): string {
  return withLang(lang, `/api/${source}/audio/${path}${version === undefined ? "" : `?v=${version}`}`);
}

/**
 * Who says a quests line, with their NPC page and the explorer narrowed to their lines, and
 * what picked their voice. Race, gender and flavor rather than the voice alone: "wrong voice
 * for this character" is a complaint about that triple, and the voice is what it currently
 * resolves to.
 */
export function speakerOf(
  line: Pick<CorpusLine, "npcId" | "npcName" | "npcType" | "source" | "race" | "gender" | "flavor" | "voice">,
): { speaker: NonNullable<Heading["speaker"]>; aside: string } {
  const who = [line.race, line.gender, line.flavor].filter(Boolean).join(" ");
  return {
    speaker: {
      name: line.npcName,
      page: npcPageHref(line.npcId),
      search: npcHref({ npcId: line.npcId, npcType: line.npcType, gossip: line.source === "gossip" }),
    },
    aside: [who, line.voice].filter(Boolean).join(" · "),
  };
}

function questDetail(line: QuestLine, version: number | undefined, lang: Lang): LineDetail {
  return {
    heading: line.questTitle ?? line.npcName,
    headingHref:
      line.questTitle && line.questId !== null ? questsHref({ q: String(line.questId), filter: "quest" }) : null,
    ...speakerOf(line),
    speakerIsHeading: !line.questTitle,
    stale: isStale("quests", line),
    // The override when there is one: it is what the next take will say, and a panel that
    // showed the corpus text would report a rewrite as having changed nothing.
    text: line.override ?? line.text,
    audioSrc: line.hasAudio ? audio("quests", line.audioPath, version, lang) : null,
    lineId: line.lineId,
  };
}

function zoneDetail(line: ZoneLine, version: number | undefined, lang: Lang): LineDetail {
  return {
    heading: line.name,
    headingHref: null,
    speaker: null,
    speakerIsHeading: false,
    aside: line.zoneName,
    stale: isStale("places", line),
    text: line.text,
    audioSrc: line.state === "missing" ? null : audio("places", `${line.file}.mp3`, version, lang),
    lineId: line.id,
  };
}

function bookDetail(line: BookLine, version: number | undefined, lang: Lang): LineDetail {
  return {
    heading: line.title,
    headingHref: null,
    speaker: null,
    speakerIsHeading: false,
    aside: `page ${line.pageNumber} of ${line.pageCount}`,
    stale: isStale("readables", line),
    text: line.text,
    audioSrc: line.state === "missing" ? null : audio("readables", `${line.file}.mp3`, version, lang),
    lineId: line.id,
  };
}

function bossDetail(line: BossLine, version: number | undefined, lang: Lang): LineDetail {
  return {
    heading: line.name,
    headingHref: null,
    speaker: null,
    speakerIsHeading: false,
    aside: line.instanceName,
    stale: isStale("bosses", line),
    text: line.text,
    // A take of a story since withdrawn would play words the panel no longer shows.
    audioSrc:
      line.text === null || line.state === "missing" ? null : audio("bosses", `${line.file}.mp3`, version, lang),
    lineId: line.id,
  };
}
