-- A voice slot that is always spoken by fish.audio in a language, whichever generator the
-- collaborator generating has chosen on /voices.
--
-- On the reference rather than a table of its own: a slot fish.audio cannot speak without a
-- reference has nothing to be pinned to, and removing the reference unpins it with no
-- second row left behind to say otherwise. Re-cutting keeps the pin.
alter table "fish_reference" add column "pinned" boolean not null default false;
