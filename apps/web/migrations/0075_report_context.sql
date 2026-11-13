-- What the addon knew when the player pressed Report: its version, the client, the text on
-- screen and the NPC, as the contribute envelope's fields and text ({ fields, text }).
--
-- Null for every report filed before this, from an older addon, or from the site's own
-- pages. Claimed by the player's client and never checked against anything, so triage shows
-- it as what the player saw rather than as what the line is.
alter table "report" add column "context" jsonb;
