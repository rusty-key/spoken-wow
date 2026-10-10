-- Who an NPC is, apart from who reads it.
--
-- A voice was named for the NPC it read: a billboard was a `narrator/male` NPC because the
-- narrator reads it, and a treant had nowhere to go. An NPC now has a type (column "race": a
-- real race, or the generics gameobject, item and creature), an optional gender and an optional
-- flavor, and each combination is read by a voice, several by one if need be. The roster was
-- code (voices.ts ROSTER); it is these tables now, edited by an admin at /npcs.
--
-- A voice keeps the race and gender its files are named by -- a gossip file is
-- md5(text + race + gender) -- so a gameobject's greeting still names narrator/male, and no id
-- moves. No foreign key from npc to race: npc holds model-{id} slots, which are a pattern and
-- not rows, and client guesses with a gender and no race. The writers validate instead.
--
-- Additive: voices.ts ROSTER and the speaker columns stay, for the previous release.

create table if not exists "race" (
  "key"       text primary key check ("key" ~ '^[a-z0-9]+$'),
  "label"     text,
  "createdAt" timestamptz not null default now()
);

-- A race with no rows here has no gender: a treant, a gameobject.
create table if not exists "gender" (
  "race"   text not null references "race" ("key"),
  "gender" text not null check ("gender" in ('male', 'female')),
  primary key ("race", "gender")
);

create table if not exists "flavor" (
  "race"   text not null references "race" ("key"),
  "gender" text,
  "flavor" text not null check ("flavor" ~ '^[a-z0-9]+$'),
  "label"  text,
  foreign key ("race", "gender") references "gender" ("race", "gender")
);
create unique index if not exists "flavor_key_idx" on "flavor" ("race", coalesce("gender", ''), "flavor");

create table if not exists "voice" (
  "name"      text primary key check ("name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  "label"     text,
  "race"      text not null,
  "gender"    text not null default '',
  "createdAt" timestamptz not null default now()
);

create table if not exists "voice_assignment" (
  "race"   text not null references "race" ("key"),
  "gender" text,
  "flavor" text,
  "voice"  text not null references "voice" ("name")
);
create unique index if not exists "voice_assignment_key_idx"
  on "voice_assignment" ("race", coalesce("gender", ''), coalesce("flavor", ''));

-- Most specific first, so a type answers for every gender and flavor it does not split by.
-- lib/voices/roster.ts voiceFor is the same lookup, for client components.
create or replace function "voice_for"(r text, g text, f text) returns text
language sql stable as $$
  select case when r ~ '^model-\d+$' then r else (
    select a."voice" from "voice_assignment" a
     where a."race" = r
       and (a."gender" is null or a."gender" = g)
       and (a."flavor" is null or a."flavor" = f)
     order by (a."gender" is not null) desc, (a."flavor" is not null) desc
     limit 1) end
$$;

-- ROSTER as voices.ts has it on 2026-10-10.
create temporary table "roster_seed" ("race" text, "gender" text, "flavor" text) on commit drop;
insert into "roster_seed" values
  ('bloodelf', 'female', null), ('bloodelf', 'male', null),
  ('dwarf', 'female', 'guard'), ('dwarf', 'female', 'maternal'), ('dwarf', 'female', 'young'),
  ('dwarf', 'male', 'grim'), ('dwarf', 'male', 'guard'), ('dwarf', 'male', 'standard'),
  ('gnome', 'female', 'happy'), ('gnome', 'female', 'nerdy'), ('gnome', 'female', 'standard'),
  ('gnome', 'male', 'standard'), ('gnome', 'male', 'young'), ('gnome', 'male', 'zany'),
  ('goblin', 'female', 'zany'),
  ('goblin', 'male', 'gruff'), ('goblin', 'male', 'guard'), ('goblin', 'male', 'zany'),
  ('human', 'female', 'official'), ('human', 'female', 'standard'), ('human', 'female', 'warrior'),
  ('human', 'male', 'official'), ('human', 'male', 'standard'), ('human', 'male', 'warrior'),
  ('nightelf', 'female', 'priestess'), ('nightelf', 'female', 'sentinel'), ('nightelf', 'female', 'standard'),
  ('nightelf', 'male', 'official'), ('nightelf', 'male', 'standard'), ('nightelf', 'male', 'warrior'),
  ('orc', 'female', 'shaman'), ('orc', 'female', 'standard'), ('orc', 'female', 'warrior'),
  ('orc', 'male', 'guard'), ('orc', 'male', 'shady'), ('orc', 'male', 'standard'),
  ('scourge', 'female', 'magic'), ('scourge', 'female', 'standard'), ('scourge', 'female', 'warrior'),
  ('scourge', 'male', 'dark'), ('scourge', 'male', 'standard'), ('scourge', 'male', 'warrior'),
  ('skybourneelf', 'female', '3773'), ('skybourneelf', 'female', '3774'),
  ('skybourneelf', 'male', '3776'), ('skybourneelf', 'male', '3775'),
  ('tauren', 'female', 'official'), ('tauren', 'female', 'shaman'), ('tauren', 'female', 'standard'),
  ('tauren', 'male', 'elder'), ('tauren', 'male', 'shaman'), ('tauren', 'male', 'warrior'),
  ('troll', 'female', 'laidback'), ('troll', 'female', 'old'), ('troll', 'female', 'standard'),
  ('troll', 'male', 'dark'), ('troll', 'male', 'shaman'), ('troll', 'male', 'standard');

insert into "race" ("key") select distinct "race" from "roster_seed" on conflict do nothing;
insert into "gender" ("race", "gender")
  select distinct "race", "gender" from "roster_seed" on conflict do nothing;
insert into "flavor" ("race", "gender", "flavor")
  select "race", "gender", "flavor" from "roster_seed" where "flavor" is not null
  on conflict do nothing;
insert into "voice" ("name", "race", "gender")
  select "race" || '-' || "gender" || coalesce('-' || "flavor", ''), "race", "gender" from "roster_seed"
  on conflict do nothing;
insert into "voice_assignment" ("race", "gender", "flavor", "voice")
  select "race", "gender", "flavor", "race" || '-' || "gender" || coalesce('-' || "flavor", '')
    from "roster_seed"
  on conflict do nothing;

-- The narrator reads, but is nobody: a voice and no type.
insert into "voice" ("name", "race", "gender") values ('narrator-male', 'narrator', 'male')
  on conflict do nothing;
insert into "race" ("key", "label") values
  ('gameobject', 'Gameobject'), ('item', 'Item'), ('creature', 'Creature')
  on conflict do nothing;
insert into "voice_assignment" ("race", "gender", "flavor", "voice") values
  ('gameobject', null, null, 'narrator-male'), ('item', null, null, 'narrator-male'),
  ('creature', null, null, 'narrator-male')
  on conflict do nothing;

-- Races NPCs already have that ROSTER never voiced (highmountaintauren, broken): types an admin
-- can now give a voice, with the genders they were seen with.
insert into "race" ("key")
  select distinct "race" from "npc" where "race" ~ '^[a-z0-9]+$' and "race" <> 'narrator'
  on conflict do nothing;
insert into "gender" ("race", "gender")
  select distinct "race", "gender" from "npc"
   where "race" ~ '^[a-z0-9]+$' and "race" <> 'narrator' and "gender" in ('male', 'female')
  on conflict do nothing;

-- A billboard, an item or a narrated creature is what it is; the narrator still reads it.
update "npc" set "race" = "npcKind", "gender" = null
 where "race" = 'narrator' and "npcKind" in ('gameobject', 'item');
update "npc" set "race" = 'creature', "gender" = null
 where "race" = 'narrator' and "npcKind" = 'creature';

-- Every NPC a speaker names that nobody has answered for: the values its lines were written
-- with, as a guess, so a reader of npc alone keeps the voice the speaker rows gave, and an admin
-- finds it among the unconfirmed. English rows first, then the most common answer.
with spoken as (
  select distinct on (s."npcType", s."npcId")
         s."npcType", s."npcId",
         case when s."race" = 'narrator' then
           case when s."npcType" in ('gameobject', 'item') then s."npcType" else 'creature' end
         else s."race" end as "race",
         case when s."race" = 'narrator' then null else s."gender" end as "gender",
         s."flavor"
    from (select "npcType", "npcId", "race", "gender", "flavor",
                 bool_or("lang" = 'enUS') as "en", count(*) as "n"
            from "quest_line_speaker"
           where "race" is not null and "race" <> ''
           group by 1, 2, 3, 4, 5) s
   order by s."npcType", s."npcId", s."en" desc, s."n" desc, s."flavor"
)
insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed")
select "npcType", "npcId", "race", "gender", "flavor", 'client', false from spoken
on conflict ("npcKind", "npcId") do update
  set "race" = excluded."race", "gender" = excluded."gender", "flavor" = excluded."flavor",
      "provenance" = 'client', "confirmed" = false, "updatedAt" = now()
  -- A moderator's "no race" is an answer; only an NPC nobody answered takes the speakers'.
  where "npc"."provenance" = 'none';
