-- Boss lore, moved from committed Lua into the database: which instances and bosses exist,
-- their names, and their stories.
--
-- boss is the boss's structure, once per boss; boss_line holds each language's story for it.
-- They are separate so a story exists in any language whether English has one or not: a
-- language's row never references another language's, and no query asks whether English has
-- text before returning a German one.
--
-- "boss"."id" is the primary encounter id. The pipelines match a boss by it, never by "key".
-- "key" is minted from the English name when the boss first appears and frozen after that, so
-- a boss the game renames keeps its key and its stories; only the extracted names move.
-- "encounterIds" is every encounter id that stands for the same boss (difficulties, versions).
--
-- "boss_instance"."map" is the map id. "kind" is 'dungeon' or 'world'; a world instance is the
-- open-world bosses of one zone, and its bosses carry the zone they stand in as "boss"."zone".
-- "storyMap" and "storyKey" name where an instance's own story is kept, when it has one.
--
-- A boss the client dropped, or one listed as unconfirmed, is retired rather than deleted, so
-- its stories survive; the export leaves retired bosses out.
--
-- Names live in entity_name: kind 'boss' with the boss id as text, kind 'instance' with the
-- map as text. That table's kind check is widened to allow both.
--
-- "origin" is 'rewritten' for text a tool wrote, 'edited' for text a person wrote here. A tool
-- write never replaces an edited row; it lands as a non-current version underneath.
--
-- Additive and forward-only per deploy/web/bin/migrate.sh: the tables are new and the check
-- only gains values.

create table "boss_instance" (
  "map"      integer primary key,
  "kind"     text    not null check ("kind" in ('dungeon', 'world')),
  "zone"     integer not null,
  "storyMap" integer,
  "storyKey" text,
  "position" integer not null
);

create table "boss" (
  "id"           integer primary key,
  "map"          integer     not null references "boss_instance" ("map"),
  "key"          text        not null,
  "position"     integer     not null,
  "encounterIds" integer[]   not null,
  "creatureId"   integer,
  "displayId"    integer,
  -- The zone a world boss stands in; null for a dungeon boss.
  "zone"         integer,
  "retired"      boolean     not null default false,
  "createdAt"    timestamptz not null default now(),
  unique ("map", "key")
);

create table "boss_line" (
  "bossId"    integer     not null references "boss" ("id"),
  "lang"      text        not null,
  "version"   integer     not null,
  "isCurrent" boolean     not null default false,
  "origin"    text        not null check ("origin" in ('rewritten', 'edited')),
  "text"      text        not null,
  "source"    text,
  "editedBy"  text        references "user" ("id") on delete set null,
  "note"      text,
  "createdAt" timestamptz not null default now(),
  unique ("bossId", "lang", "version")
);

-- Exactly one live version per boss per language, enforced rather than trusted: two current
-- rows make the export ambiguous, and the export is what the addon ships.
create unique index "boss_line_current_idx"
  on "boss_line" ("bossId", "lang") where "isCurrent";

alter table "entity_name" drop constraint "entity_name_kind_check";
alter table "entity_name" add constraint "entity_name_kind_check"
  check ("kind" in ('quest', 'creature', 'gameobject', 'item', 'zone', 'subzone', 'boss', 'instance'));
