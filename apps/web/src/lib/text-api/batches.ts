/** Mass updates: a record of each run, and undoing one. */
import "server-only";

import { query } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import type { Section } from "./types";

export async function createBatch(args: {
  userId: string;
  tokenId: string;
  lang: Lang;
  section: Section;
  itemCount: number;
  note: string | null;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into "api_batch" ("userId", "tokenId", "lang", "section", "itemCount", "note")
     values ($1, $2, $3, $4, $5, $6)
     returning "id"`,
    [args.userId, args.tokenId, args.lang, args.section, args.itemCount, args.note],
  );
  return rows[0].id;
}
