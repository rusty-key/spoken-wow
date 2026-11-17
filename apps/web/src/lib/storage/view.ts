/** What the storage page shows, and how its routes answer a refusal. */
import "server-only";

import { readsBlobs } from "@/lib/blobs/store";
import { query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { NoTeamError, teamOf } from "@/lib/teams/store";

import { listBackends, PROVIDERS, StorageError, type BackendView, type Provider } from "./backends";

export type StorageView = {
  team: { id: string; name: string; langs: Lang[] };
  backends: BackendView[];
  providers: { id: Provider; label: string; endpoint: string; region: string; pathStyle: boolean }[];
  /** False while our archive is still the volume: no team bucket can be switched on then. */
  archiveIsBucket: boolean;
  /** False without SPOKEN_STORAGE_KEY: no secret can be saved. */
  canSeal: boolean;
};

export async function storageView(lang: Lang): Promise<StorageView> {
  const team = await teamOf(lang);
  const [[about], langs, backends] = await Promise.all([
    query<{ id: string; name: string }>(`select "id", "name" from "team" where "id" = $1`, [team]),
    query<{ lang: Lang }>(`select "lang" from "team_language" where "teamId" = $1 and "privileged" order by "lang"`, [team]),
    listBackends(team),
  ]);
  return {
    team: { ...about, langs: langs.map((row) => row.lang) },
    backends,
    providers: (Object.keys(PROVIDERS) as Provider[]).map((id) => ({ id, ...PROVIDERS[id] })),
    archiveIsBucket: readsBlobs(),
    canSeal: Boolean(process.env.SPOKEN_STORAGE_KEY),
  };
}

export function refusal(error: unknown): Response {
  if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof NoTeamError) return Response.json({ error: `${error.lang} has no team.` }, { status: 400 });
  throw error;
}
