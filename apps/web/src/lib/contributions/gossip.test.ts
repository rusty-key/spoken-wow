import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { BROADCAST_READINGS, GOSSIP_LOCALE_TEXT } from "./gossip";

/** Only bitmap scans are allowed, so a usable index is the one that shows. */
async function planOf(sql: string): Promise<string> {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("set local enable_seqscan = off");
    await client.query("set local enable_indexscan = off");
    await client.query("set local enable_indexonlyscan = off");
    const { rows } = await client.query<{ "QUERY PLAN": string }>(`explain ${sql}`);
    return rows.map((row) => row["QUERY PLAN"]).join("\n");
  } finally {
    await client.query("rollback");
    client.release();
  }
}

afterAll(closeDb);

describe("the gossip text lookups and migration 0104's indexes", () => {
  it("reads broadcast texts through the index on their readings", async () => {
    const plan = await planOf(`select 1 from "broadcast_text" b where ${BROADCAST_READINGS} @> array['x']`);
    expect(plan).toContain("broadcast_text_readings_idx");
  });

  it("reads gossip lines through the index on their localized text", async () => {
    const plan = await planOf(
      `select 1 from "quest_line" where "lang" = 'enUS' and "source" = 'gossip' and ${GOSSIP_LOCALE_TEXT} = 'x'`,
    );
    // In the Index Cond, since an index that matches on "lang" alone still names itself.
    expect(plan).toMatch(/quest_line_gossip_text_idx[\s\S]*Index Cond:.*regexp_replace/);
  });
});
