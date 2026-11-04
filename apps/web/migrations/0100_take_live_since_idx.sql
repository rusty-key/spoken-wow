-- Additive. The release page counts, on every check, a section's live takes cut since its last
-- release (lib/releases/pending.ts), and take_team_current_idx orders by file, so each count
-- read every live take of the language. Same predicate, ordered by when it was cut.
create index if not exists "take_live_since_idx"
  on "take" ("teamId", "source", "lang", "createdAt") where "isCurrent";
