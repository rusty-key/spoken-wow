-- One creature id can be drawn as a man or a woman (a Stormwind City Guard). An NPC with rows
-- here is split: each sex the client reports (UnitSex: 2 male, 3 female) has its own answer and
-- every line it speaks is voiced once per sex. The npc row stays the answer wherever the sex is
-- unknown. Additive: no reader of npc changes.

create table if not exists "npc_sex" (
  "npcKind"    text not null,
  "npcId"      integer not null,
  "sex"        smallint not null,
  "gender"     text generated always as (case "sex" when 2 then 'male' else 'female' end) stored,
  "race"       text not null,
  "flavor"     text,
  "provenance" text not null,
  "confirmed"  boolean not null default false,
  "doubtful"   boolean not null default false,
  "note"       text,
  "resolvedBy" text references "user" ("id") on delete set null,
  "updatedAt"  timestamptz not null default now(),
  primary key ("npcKind", "npcId", "sex"),
  foreign key ("npcKind", "npcId") references "npc" ("npcKind", "npcId") on delete cascade,
  constraint "npc_sex_sex_check" check ("sex" in (2, 3)),
  constraint "npc_sex_provenance_check"
    check ("provenance" in ('corpus', 'display', 'client', 'moderator')),
  constraint "npc_sex_confirmed_provenance_check"
    check (not "confirmed" or "provenance" in ('corpus', 'display', 'moderator')),
  constraint "npc_sex_doubtful_provenance_check"
    check (not "doubtful" or "provenance" in ('moderator', 'corpus'))
);
