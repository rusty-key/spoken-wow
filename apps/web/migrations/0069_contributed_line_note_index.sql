-- Whether an accepted contribution has written its line (contributions/accept.ts
-- contributedLineExists) is asked once per row of the moderation page, by the note the accept
-- leaves on it. Without an index each ask is a sequential scan of every language's quest_line.
-- Only contributed rows carry such a note, so the index holds those alone.
--
-- Additive, per deploy/web/bin/migrate.sh: the previous release neither reads nor minds it.

create index if not exists "quest_line_contributed_note_idx"
  on "quest_line" ("note") where "origin" = 'contributed';
