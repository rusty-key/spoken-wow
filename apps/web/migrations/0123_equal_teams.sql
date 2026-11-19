-- A language's teams are equal (docs/platform/TEAMS.md). Additive but for the line_ignore check,
-- replaced whole as 0097 replaced release_run's state check.
--
-- What made a team the language's "privileged" one now only names its packs: "packName" is
-- 'plain' (<Pack>_<lang>) or 'slug' (<Pack>_<lang>_<slug>), set when the team joins the language
-- and never changed, so no pack a player has is renamed.

-- PACK NAMES. Every team privileged today keeps its plain packs.
alter table "team_language" add column "packName" text check ("packName" in ('plain', 'slug'));
update "team_language" set "packName" = case when "privileged" then 'plain' else 'slug' end;
alter table "team_language" alter column "packName" set not null;
create unique index "team_language_plain_idx" on "team_language" ("lang") where "packName" = 'plain';

-- An insert that names no pack name gets plain packs when the team's slug is the language's code
-- and no team of the language has them. "privileged" is no longer anybody's input but a previous
-- release's, which asks for the main team with privileged = true: that is a request for plain
-- packs, and the unique index refuses it as it did. So it defaults to false, and is then made to
-- follow "packName", so a rolled-back release still finds the team it calls privileged.
alter table "team_language" alter column "privileged" set default false;

create function "team_language_pack_name"() returns trigger
language plpgsql as $$
begin
  if new."packName" is null then
    new."packName" := case
      when new."privileged" then 'plain'
      when (select "slug" from "team" where "id" = new."teamId") = lower(new."lang")
           and not exists (select 1 from "team_language"
                            where "lang" = new."lang" and "packName" = 'plain') then 'plain'
      else 'slug' end;
  end if;
  new."privileged" := new."packName" = 'plain';
  return new;
end
$$;

create trigger "team_language_pack_name"
  before insert on "team_language"
  for each row execute function "team_language_pack_name"();

-- A pack name that changed would re-ship every pack of the team and orphan its players' copies.
create function "team_language_pack_name_frozen"() returns trigger
language plpgsql as $$
begin
  if new."packName" is distinct from old."packName" then
    raise exception 'a team''s pack name in % never changes', old."lang";
  end if;
  return new;
end
$$;

create trigger "team_language_pack_name_frozen"
  before update on "team_language"
  for each row execute function "team_language_pack_name_frozen"();

-- Kept for a rolled-back release and the scripts that still call it: the team whose packs carry
-- no slug, not a main team.
create or replace function "team_of_lang"(text) returns uuid language sql stable as $$
  select "teamId" from "team_language" where "lang" = $1 and "packName" = 'plain'
$$;
