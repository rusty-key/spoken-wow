-- English takes several teams like any other language, so a team can be requested for it. The
-- code shape stays checked; a previous release still refuses English before it reaches here.
alter table "team_request" drop constraint "team_request_lang_check";
alter table "team_request" add constraint "team_request_lang_check" check ("lang" ~ '^[a-z]{2}[A-Z]{2}$');
