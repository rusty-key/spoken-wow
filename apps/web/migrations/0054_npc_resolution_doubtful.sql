-- A moderator's answer they are not sure of.
--
-- Plenty of NPCs have a race and gender anyone can see and a flavor nobody can yet say for
-- certain. Waiting for certainty would hold their lines back, so a moderator saves a best
-- answer and flags it: "doubtful" rows are still moderator answers, still confirmed, and voice
-- and generate like any other -- the flag only marks them for a later review pass on
-- /contributions/npcs.
--
-- Only a moderator can doubt, since only a person's answer is one to revisit: a corpus row is
-- exact, and a client or none row is already unconfirmed, which is its own review queue.
--
-- Additive and forward-only: the default keeps every existing row as it was.

alter table "npc_resolution"
  add column if not exists "doubtful" boolean not null default false;

alter table "npc_resolution"
  add constraint "npc_resolution_doubtful_provenance_check"
    check (not "doubtful" or "provenance" = 'moderator');
