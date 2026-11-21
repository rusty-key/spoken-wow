/**
 * Where players met each NPC, from the `seen` envelopes their uploads carry
 * (lib/contributions/sighting.ts): the game's own answer to which zone a speaker stands in, for
 * the zone filter (lib/quests/zones.ts).
 *
 * A zone counts for an NPC once VOUCHERS uploaders have sent it: one player's file, sent again
 * after every logout, is one voice. Not a defence against someone set on poisoning it, which
 * would take many accounts, and the filter is worth nothing to them.
 */
import "server-only";

import type { Sighting } from "@/lib/contributions/sighting";
import { query } from "@/lib/db";
import { zoneSeed } from "@/lib/places/tools";

import type { QuestZone } from "./zones";

export const VOUCHERS = 2;

// The world and the two continents: the addon walks a map up to a zone and stops below them.
const NOT_ZONES = new Set([947, 1414, 1415]);

/** Every zone a sighting may name, by uiMapID: the places seed's. */
const KNOWN_ZONES: ReadonlyMap<number, string> = new Map(
  Object.entries(zoneSeed).flatMap(([id, row]) =>
    /^\d+$/.test(id) && !Array.isArray(row) && !NOT_ZONES.has(Number(id)) ? [[Number(id), row.name] as const] : [],
  ),
);

/**
 * Who vouches for a sighting: the account, else the Manager's install, else this upload alone. No
 * address is kept, so an anonymous file uploaded twice counts twice: it takes the page, by hand.
 */
export function uploaderOf({ userId, installId }: { userId: string | null; installId: string | null }): string {
  if (userId) return `user:${userId}`;
  if (installId) return `install:${installId}`;
  return `upload:${crypto.randomUUID()}`;
}

/** Stores what one uploader saw, each NPC and zone once. A zone no list knows is dropped. Returns the rows new. */
export async function recordSightings(sightings: readonly Sighting[], uploader: string): Promise<number> {
  const types: string[] = [];
  const ids: number[] = [];
  const zones: number[] = [];
  for (const sighting of sightings) {
    for (const zone of sighting.zones) {
      if (!KNOWN_ZONES.has(zone)) continue;
      types.push(sighting.npcType);
      ids.push(sighting.npcId);
      zones.push(zone);
    }
  }
  if (zones.length === 0) return 0;
  const rows = await query<{ npcId: number }>(
    `insert into "npc_sighting" ("npcType", "npcId", "uiMapID", "uploader")
     select t, i, z, $4 from unnest($1::text[], $2::int[], $3::int[]) as s (t, i, z)
     on conflict do nothing
     returning "npcId"`,
    [types, ids, zones, uploader],
  );
  return rows.length;
}

// Read by every zone search and, through the facets, every search: a sighting vouched for a minute
// late is fine, and the whole table is aggregated once a minute rather than per keystroke.
const TTL_MS = 60_000;
let vouched: { at: number; sightings: Promise<Map<string, number[]>> } | null = null;

/** npcKey -> the zones VOUCHERS uploaders agree it stands in, by uiMapID. An outage reads as none. */
export function confirmedSightings(now = Date.now()): Promise<Map<string, number[]>> {
  if (!vouched || now - vouched.at > TTL_MS) {
    const sightings = query<{ npcType: string; npcId: number; zones: number[] }>(
      `select "npcType", "npcId", array_agg("uiMapID" order by "uiMapID") as "zones"
         from (select "npcType", "npcId", "uiMapID" from "npc_sighting"
                group by 1, 2, 3 having count(*) >= $1) as "vouched"
        group by 1, 2`,
      [VOUCHERS],
    )
      .then((rows) => new Map(rows.map((row) => [`${row.npcType}:${row.npcId}`, row.zones])))
      .catch(() => new Map<string, number[]>());
    vouched = { at: now, sightings };
  }
  return vouched.sightings;
}

/** The zones the filter offers, by name: those some vouched sighting names, so no choice selects nothing. */
export async function offeredZones(now = Date.now()): Promise<readonly QuestZone[]> {
  const byId = new Map<number, QuestZone>();
  for (const zones of (await confirmedSightings(now)).values()) {
    for (const uiMapID of zones) {
      const name = KNOWN_ZONES.get(uiMapID);
      if (name && !byId.has(uiMapID)) byId.set(uiMapID, { uiMapID, name });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
