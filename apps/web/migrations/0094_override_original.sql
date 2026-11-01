-- The original line's hash when an override was last saved, so the override can say when the
-- original under it has changed since. Null for rows saved before this: they stay quiet until
-- saved again.
alter table "line_override" add column "originalHash" text;
