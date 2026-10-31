/**
 * Where each section archives its takes: the one thing the take layer cannot write once.
 *
 * Everything else about a take is the same in all three -- one table, one commit, one
 * history panel -- but the paths are frozen by AGENTS.md and differ on purpose. A quests
 * file carries its extension and is shared by several NPCs ('gossip/31ab….mp3'); a places or
 * readables file is extension-less and belongs to one line ('1411/razor-hill'). Renaming either
 * means re-shipping a sound pack every user has already downloaded.
 *
 * Every take of a file lives in one directory named after the file, one level deeper than
 * the addon's own path: gossip/31ab….mp3 is archived under audio-history/gossip/31ab…/.
 * What a take's archived file is called is its row's business (`archiveFile`); this only
 * says which directory it is in. There is no live copy anywhere else: the live take is a
 * flag on its row, and a pack build copies it to the addon's path (scripts/audio/sounds.mjs).
 *
 * A total Record rather than a switch, for the reason lib/generation/worker.ts gives:
 * adding a section and forgetting one of these is then a type error rather than a route
 * that resolves to the wrong directory.
 *
 * ANOTHER LANGUAGE'S TAKES LIVE ONE LEVEL DOWN, under a directory named for the language:
 * audio-history/ptBR/gossip/31ab…/. Version numbers count per language, so without it the
 * English v1 and the Portuguese v1 of a file would share a directory and be told apart only
 * by a content hash. English stays exactly where it is -- the archive is irreplaceable and a
 * path it is already at is not moved -- and no English path can begin with a language code:
 * quests paths begin quests/ or gossip/, places and bosses paths a map id, readables paths a
 * page id.
 */
import "server-only";

import path from "node:path";

import { historyDir as readablesHistory } from "@/lib/readables/audio";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { AUDIO_HISTORY_DIR } from "@/lib/paths";
import { isSafeAudioPath } from "@/lib/range";
import type { Source } from "@/lib/sections";
import { historyDir as placesHistory } from "@/lib/places/tools";

/** Joined for the tracer, for the reason lib/paths.ts gives. */
const PLACES_DIR = ["pipelines", "places"].join(path.sep);

function bossesHistory(): string {
  return (
    process.env.SPOKEN_BOSSES_AUDIO_HISTORY ??
    path.join(path.resolve(process.cwd(), "..", "..", PLACES_DIR), "bosses-audio-history")
  );
}

type StoreAdapter = {
  /** The section's archive, which a deployment points at its own directory. */
  root: () => string;
  /** Where one line's archived takes live, relative to the root. */
  relative: (file: string) => string;
};

/**
 * Quests paths come from a request body more directly than the other two, and are checked
 * against a whitelist pattern -- not sanitised -- the same one /api/quests/audio uses.
 */
function questsFile(file: string): string {
  if (!isSafeAudioPath(file)) throw new Error(`unsafe store path ${file}`);
  return file;
}

const ADAPTERS: Record<Source, StoreAdapter> = {
  quests: {
    root: () => AUDIO_HISTORY_DIR,
    relative: (file) => path.join(path.dirname(questsFile(file)), path.basename(file, ".mp3")),
  },
  places: {
    root: placesHistory,
    relative: (file) => file,
  },
  readables: {
    root: readablesHistory,
    relative: (file) => file,
  },
  bosses: {
    root: bossesHistory,
    relative: (file) => file,
  },
};

export function historyDirOf(source: Source, file: string, lang: Lang = BASE_LANG): string {
  const adapter = ADAPTERS[source];
  const relative = adapter.relative(file);
  return lang === BASE_LANG
    ? path.join(adapter.root(), relative)
    : path.join(adapter.root(), lang, relative);
}

/**
 * Where a voice actor's recordings of one file live: the same per-file directory, under
 * recorded/<lang>/ in the section's archive. Every language has the level, English
 * included, since there is no older layout to keep. `recorded` can be no section path's
 * first segment -- see the list above -- nor a language code.
 *
 * In the archive because it is as irreplaceable as the takes: an actor's session is not
 * something that can be cut again for a few credits.
 */
export function recordedDirOf(source: Source, file: string, lang: Lang): string {
  const adapter = ADAPTERS[source];
  return path.join(adapter.root(), "recorded", lang, adapter.relative(file));
}
