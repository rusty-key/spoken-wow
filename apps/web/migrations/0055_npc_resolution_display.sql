-- A fifth provenance: "display", the voice set the game itself wires to the appearance a player
-- saw, reported by the addon as appearance ids and mapped through display-voices.json. It is
-- exact in the same sense the corpus is -- it comes from the game's data, not a guess -- so it
-- may be confirmed, which 0031 reserved for corpus and moderator.
--
-- Both constraints are dropped by the names 0030 and 0031 gave them, as 0028 explains: a
-- `drop constraint if exists` on a name Postgres did not choose silently keeps the old one.
alter table "npc_resolution" drop constraint "npc_resolution_provenance_check";
alter table "npc_resolution"
  add constraint "npc_resolution_provenance_check"
    check ("provenance" in ('corpus', 'display', 'client', 'moderator', 'none'));

alter table "npc_resolution" drop constraint "npc_resolution_confirmed_provenance_check";
alter table "npc_resolution"
  add constraint "npc_resolution_confirmed_provenance_check"
    check (not "confirmed" or "provenance" in ('corpus', 'display', 'moderator'));
