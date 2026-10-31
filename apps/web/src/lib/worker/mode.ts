/** Stored per provider, because keys are per provider. No row means `site`. */
import "server-only";

import { db } from "@/lib/db";
import type { Provider } from "@/lib/generation/speakers/speaker";

import type { GenerationMode } from "./protocol";

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
