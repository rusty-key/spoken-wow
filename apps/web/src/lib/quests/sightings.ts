/**
 * Where players met each NPC, from the `seen` envelopes their uploads carry
 * (lib/contributions/sighting.ts): the game's own answer to which zone a speaker stands in, for
 * the zone filter beside corpus/zones.json's (lib/quests/zones.ts).
 *
 * Anyone can hand-build a file, so a zone counts for an NPC only once VOUCHERS uploaders have
 * sent it. One person can still pass for two (a signed-in upload and the Manager's install id),
 * which is the bar for a filter, not for anything spent.
 */
import "server-only";

import { createHash } from "node:crypto";

import type { Sighting } from "@/lib/contributions/sighting";
import { query } from "@/lib/db";
import { zoneSeed } from "@/lib/places/tools";

import { QUEST_ZONES, type QuestZone } from "./zones";

export const VOUCHERS = 2;

// The world and the two continents: the addon walks a map up to a zone and stops below them.
const NOT_ZONES = new Set([947, 1414, 1415]);

/** Every zone a sighting may name: the places seed's, and any corpus/zones.json adds (Forever's). */
const KNOWN_ZONES: ReadonlyMap<number, string> = new Map([
  ...Object.entries(zoneSeed).flatMap(([id, row]) =>
    /^\d+$/.test(id) && !Array.isArray(row) && !NOT_ZONES.has(Number(id)) ? [[Number(id), row.name] as const] : [],
  ),
  ...QUEST_ZONES.map((zone) => [zone.uiMapID, zone.name] as const),
]);

/** Who vouches for a sighting: the account, else the Manager's install, else a hash of the address. */
export function uploaderOf({ userId, installId, ip }: { userId: string | null; installId: string | null; ip: string | null }): string | null {
  if (userId) return `user:${userId}`;
  if (installId) return `install:${installId}`;
  return ip ? `ip:${createHash("sha256").update(ip).digest("hex")}` : null;
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

/** npcKey -> the zones VOUCHERS uploaders agree it stands in, by uiMapID. */
export async function confirmedSightings(): Promise<Map<string, number[]>> {
  const rows = await query<{ npcType: string; npcId: number; zones: number[] }>(
    `select "npcType", "npcId", array_agg("uiMapID" order by "uiMapID") as "zones"
       from (select "npcType", "npcId", "uiMapID" from "npc_sighting"
              group by 1, 2, 3 having count(*) >= $1) as "vouched"
      group by 1, 2`,
    [VOUCHERS],
  );
  return new Map(rows.map((row) => [`${row.npcType}:${row.npcId}`, row.zones]));
}

// Asked by every search request through the facets; a sighting vouched for a minute late is fine.
const OFFERED_TTL_MS = 60_000;
let offered: { at: number; zones: Promise<readonly QuestZone[]> } | null = null;

/** The zones the filter offers: corpus/zones.json's, and every zone a vouched sighting adds, by name. */
export function offeredZones(now = Date.now()): Promise<readonly QuestZone[]> {
  if (!offered || now - offered.at > OFFERED_TTL_MS) {
    const zones = query<{ uiMapID: number }>(
      `select distinct "uiMapID" from (select "uiMapID" from "npc_sighting"
         group by "npcType", "npcId", "uiMapID" having count(*) >= $1) as "vouched"`,
      [VOUCHERS],
    )
      .then((rows) => {
        const byId = new Map(QUEST_ZONES.map((zone) => [zone.uiMapID, zone]));
        for (const { uiMapID } of rows) {
          const name = KNOWN_ZONES.get(uiMapID);
          if (name && !byId.has(uiMapID)) byId.set(uiMapID, { uiMapID, name });
        }
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      })
      // An outage offers the export's zones rather than failing every search.
      .catch(() => QUEST_ZONES);
    offered = { at: now, zones };
  }
  return offered.zones;
}
