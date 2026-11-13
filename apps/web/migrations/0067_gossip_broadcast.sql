-- Which BroadcastText row a gossip line speaks: the language-neutral id that lets a greeting seen
-- in any language find its line (broadcast_text, migration 0066, holds the texts).
--
-- Per line, not per language: every language's row of a line is the same moment. A line can have
-- several ids, because one text can sit under several BroadcastText rows that read alike.
--
-- Additive: a new table the previous release never reads.

create table if not exists "gossip_broadcast" (
  "lineId"          text        not null,
  "broadcastTextId" integer     not null,
  -- 'extract': the world database names this id for an NPC saying the line.
  -- 'text': the line's English text equals this id's English text.
  "matchedBy"       text        not null check ("matchedBy" in ('extract', 'text')),
  "createdAt"       timestamptz not null default now(),
  primary key ("lineId", "broadcastTextId")
);

create index if not exists "gossip_broadcast_id_idx" on "gossip_broadcast" ("broadcastTextId");
