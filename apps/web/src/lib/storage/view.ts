import "server-only";

import { keepsOwnStorage } from "@/lib/blobs/keep";
import { canSeal } from "@/lib/blobs/seal";
import { readsBlobs } from "@/lib/blobs/store";
import { query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { teamOf } from "@/lib/teams/store";

import { listBackends, PROVIDERS, type BackendView, type Provider } from "./backends";
import { listMoves, type MoveView } from "./moves";

export type StorageView = {
  team: { id: string; name: string; langs: Lang[] };
  backends: BackendView[];
  /** The newest first; at most one queued or running. */
  moves: MoveView[];
  providers: { id: Provider; label: string; endpoint: string; region: string; pathStyle: boolean }[];
  /** False while our archive is still the volume: no team bucket can be switched on then. */
  archiveIsBucket: boolean;
  /** False without SPOKEN_STORAGE_KEY: no secret can be saved. */
  canSeal: boolean;
  /** New objects may not go to our archive; what is already there stays (team."ownStorage"). */
  ownStorage: boolean;
};

export async function storageView(lang: Lang): Promise<StorageView> {
  const team = await teamOf(lang);
  // Moves before the buckets' counts, so a move shown as done never has counts from before it.
  const moves = await listMoves(team);
  const [[about], langs, backends, ownStorage] = await Promise.all([
    query<{ id: string; name: string }>(`select "id", "name" from "team" where "id" = $1`, [team]),
    query<{ lang: Lang }>(`select "lang" from "team_language" where "teamId" = $1 and "privileged" order by "lang"`, [team]),
    listBackends(team),
    keepsOwnStorage(team),
  ]);
  return {
    team: { ...about, langs: langs.map((row) => row.lang) },
    backends,
    moves,
    providers: (Object.keys(PROVIDERS) as Provider[]).map((id) => ({ id, ...PROVIDERS[id] })),
    archiveIsBucket: readsBlobs(),
    canSeal: canSeal(),
    ownStorage,
  };
}
