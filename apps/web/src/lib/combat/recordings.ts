import "server-only";

import { query } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { sentText } from "@/lib/generation/files";
import { spokenHash } from "@/lib/generation/spoken-hash";
import { COMBAT_LINES } from "./catalogue";

export async function combatRecordings() {
  const rows = await query<{ file: string; version: number; durationSec: number | null; spokenHash: string | null }>(
    `select "file", "version", "durationSec"::float8 as "durationSec", "spokenHash" from "take"
      where "source" = 'quests' and "lang" = $1 and "isCurrent" and "file" = any($2::text[])`,
    [BASE_LANG, COMBAT_LINES.map((line) => line.file)],
  );
  const byFile = new Map(rows.map((row) => [row.file, row]));
  return COMBAT_LINES.map((line) => {
    const take = byFile.get(line.file);
    const duration = take?.durationSec ?? null;
    const stale = !!take && take.spokenHash !== spokenHash(sentText(line.text, BASE_LANG, null));
    return {
      ...line, version: take?.version ?? null, duration, stale,
      ready: !!take && !stale && duration !== null && duration > 0 && duration <= 6,
    };
  });
}

export type CombatRecording = Awaited<ReturnType<typeof combatRecordings>>[number];
