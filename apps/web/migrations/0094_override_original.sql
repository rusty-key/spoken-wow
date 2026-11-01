-- Null never flags, so rows saved before this stay quiet until saved again.
alter table "line_override" add column "originalHash" text;
