-- Gossip lines merged into another line of the same moment (lib/broadcast/relink.ts).
--
-- Two lines are merged when they speak the same BroadcastText id, have the same speakers, and
-- read the same in every language both have: minted twice before the id tied them. The merged
-- line's rows stop being current, and its id and file stay as they were, so its takes still
-- play through GossipAliases and a link to it still names a line.
--
-- Additive: a new table the previous release never reads.

create table if not exists "gossip_merge" (
  "lineId"     text        primary key,
  "mergedInto" text        not null,
  "mergedAt"   timestamptz not null default now()
);

create index if not exists "gossip_merge_into_idx" on "gossip_merge" ("mergedInto");
