-- A page's translation, sent by a player and accepted on the site.
--
-- Until now accepting a books contribution only flipped its status: nothing wrote the text
-- anywhere the explorer reads, so accepted Portuguese pages showed up nowhere. Accepting one
-- sent from a client in another language now writes that language's page, with origin
-- 'contributed' -- quest_line's word for the same thing (0034).
--
-- THE CONTRIBUTION DOES NOT NAME ITS PAGE. The addon sends a page only when its lookup
-- failed, so it has no pageTextID to give: its `page` field, and the contribution's key, is
-- the checksum of the text on screen (naming.mjs's pageChecksum, Contribute.lua). Which
-- English page a translation is of is a moderator's answer, kept on the contribution beside
-- the NPC 0048 lets them name, and `meta` stays what the client sent. Null until somebody
-- matches it, and a row with none cannot be accepted.
--
-- Additive, per deploy/web/bin/migrate.sh: the check only widens, and the previous release
-- never reads the new column.

alter table "book_line" drop constraint "book_line_origin_check";
alter table "book_line" add constraint "book_line_origin_check"
  check ("origin" in ('extracted', 'edited', 'contributed'));

alter table "contribution" add column if not exists "pageId" integer;
