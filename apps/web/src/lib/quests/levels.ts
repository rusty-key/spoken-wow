import { query } from "@/lib/db";

export async function questLevels(): Promise<Map<number, number>> {
  const rows = await query<{ questId: number; level: number }>(
    `select "questId", "level" from "quest_level"`,
  );
  return new Map(rows.map((row) => [row.questId, row.level]));
}
