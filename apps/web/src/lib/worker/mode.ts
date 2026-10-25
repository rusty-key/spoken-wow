/**
 * Where an author's queued lines are generated: on this site, with the key sealed here, or
 * by their Spoken Manager, with a key that never leaves their machine (migration 0085).
 *
 * Per provider, because the key is per provider. No row is `site`, which is how every
 * author generated before the Manager could.
 */
import "server-only";

import { db } from "@/lib/db";
import type { Provider } from "@/lib/generation/speakers/speaker";

export type GenerationMode = "site" | "local";

export async function readModes(userId: string): Promise<Record<Provider, GenerationMode>> {
  const { rows } = await db().query<{ provider: Provider; mode: GenerationMode }>(
    `select "provider", "mode" from "generation_mode" where "userId" = $1`,
    [userId],
  );
  const modes: Record<Provider, GenerationMode> = { elevenlabs: "site", fish: "site" };
  for (const row of rows) modes[row.provider] = row.mode;
  return modes;
}

export async function modeOf(userId: string, provider: Provider): Promise<GenerationMode> {
  return (await readModes(userId))[provider];
}

export async function writeMode(userId: string, provider: Provider, mode: GenerationMode): Promise<void> {
  await db().query(
    `insert into "generation_mode" ("userId", "provider", "mode") values ($1, $2, $3)
     on conflict ("userId", "provider") do update set "mode" = excluded."mode", "updatedAt" = now()`,
    [userId, provider, mode],
  );
}
