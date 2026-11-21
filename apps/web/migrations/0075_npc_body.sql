-- One creature id can be drawn as several bodies: a race and a sex, as the client's model and
-- UnitSex show them (an Ironforge Reveler is a dwarf or a gnome, a man or a woman). An NPC with
-- two or more rows here is split: each body has its own answer and every line it speaks is
-- voiced once per body. A split by sex is a split whose bodies differ only in sex, so npc_sex's
-- rows are copied here and npc_sex is no longer read; a later migration drops it.
-- `weight` is how often the game draws the body (the extract's display probabilities), null where
-- a moderator or a contribution added it. Additive: no reader of npc changes.

create table if not exists "npc_body" (
  "npcKind"    text not null,
  "npcId"      integer not null,
  "race"       text not null,
  "sex"        smallint not null,
  "gender"     text generated always as (case "sex" when 2 then 'male' else 'female' end) stored,
  "weight"     real,
  "flavor"     text,
  "provenance" text not null,
  "confirmed"  boolean not null default false,
  "doubtful"   boolean not null default false,
  "note"       text,
  "resolvedBy" text references "user" ("id") on delete set null,
  "updatedAt"  timestamptz not null default now(),
  primary key ("npcKind", "npcId", "race", "sex"),
  foreign key ("npcKind", "npcId") references "npc" ("npcKind", "npcId") on delete cascade,
  constraint "npc_body_sex_check" check ("sex" in (2, 3)),
  constraint "npc_body_provenance_check"
    check ("provenance" in ('corpus', 'display', 'client', 'moderator')),
  constraint "npc_body_confirmed_provenance_check"
    check (not "confirmed" or "provenance" in ('corpus', 'display', 'moderator')),
  constraint "npc_body_doubtful_provenance_check"
    check (not "doubtful" or "provenance" in ('moderator', 'corpus'))
);

insert into "npc_body" ("npcKind", "npcId", "race", "sex", "flavor", "provenance", "confirmed",
                        "doubtful", "note", "resolvedBy", "updatedAt")
select "npcKind", "npcId", "race", "sex", "flavor", "provenance", "confirmed", "doubtful", "note",
       "resolvedBy", "updatedAt"
  from "npc_sex"
on conflict do nothing;
