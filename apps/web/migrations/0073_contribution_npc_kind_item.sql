-- An item as the answer to "who speaks this?".
--
-- An item starts quests, and npc already holds item rows (0070), but a moderator naming the
-- NPC of a contribution whose envelope named none could only pick a creature or a gameobject,
-- so a quest started from an item had no right answer.
--
-- Dropped by the name 0033 gave it, as 0028 explains: a `drop constraint if exists` on a name
-- Postgres did not choose silently keeps the old one. Widening only, so the previous release
-- keeps reading every row; it reads an item answer as a kind-less one.
alter table "contribution" drop constraint "contribution_npc_kind_check";
alter table "contribution"
  add constraint "contribution_npc_kind_check" check ("npcKind" in ('creature', 'gameobject', 'item'));
