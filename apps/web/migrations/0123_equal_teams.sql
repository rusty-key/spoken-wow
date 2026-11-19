-- A language's teams are equal (docs/platform/TEAMS.md). Additive but for line_ignore's team check
-- and its key for rows with no team, each replaced whole as 0097 replaced release_run's state check.
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

-- A LANGUAGE'S OWN IGNORES. An ignore with a language and no team is the language's: every team of
-- it honours it, and row-level security already lets every team read a row with no team (0090).
-- A rejected contribution's lines are ignored so, rather than under the privileged team.
alter table "line_ignore" drop constraint "line_ignore_team_check";
alter table "line_ignore" add constraint "line_ignore_team_check" check ("teamId" is null or "lang" is not null);

-- One ignore with no team per line and language. The key it replaces allowed one per line, so a
-- language's ignore and the every-language one could not both exist. A previous release's
-- every-language ignore names that key in its conflict clause and fails until it rolls forward.
create unique index "line_ignore_teamless_idx" on "line_ignore" ("lineId", (coalesce("lang", ''))) where "teamId" is null;
drop index "line_ignore_site_wide_idx";

-- A NEW LANGUAGE'S TEAM: named by its code, with English's roster, its packs plain. Only adding a
-- language and handing one over that has no team make one: a language gets no team for being
-- known.
--
-- It acts as every team until it returns, as adopt_lang did (0091): copy_team_roster is security
-- invoker and would not see English's roster as the caller.
create function "found_lang_team"(p_lang text) returns uuid
language plpgsql as $$
declare
  v_team   uuid;
  v_caller text := current_setting('spoken.team', true);
begin
  perform set_config('spoken.team', '*', true);
  v_team := new_team(free_team_slug(lower(p_lang)), p_lang);
  perform copy_team_roster((select "id" from "team" where "slug" = 'english'), v_team);
  insert into "team_language" ("teamId", "lang", "packName") values (v_team, p_lang, 'plain');
  perform pg_notify('spoken_team_language', p_lang);
  perform set_config('spoken.team', coalesce(v_caller, ''), true);
  return v_team;
end
$$;

-- INVITES NAME THEIR TEAM. A null "joinTeamId" meant the privileged team: it becomes the plain one,
-- written in. A previous release still writes null for it, so a trigger writes the team in then.
update "invite" set "joinTeamId" = team_of_lang("lang") where "joinTeamId" is null;

create function "invite_join_team"() returns trigger
language plpgsql as $$
begin
  new."joinTeamId" := coalesce(new."joinTeamId", team_of_lang(new."lang"));
  return new;
end
$$;

create trigger "invite_join_team"
  before insert on "invite"
  for each row execute function "invite_join_team"();

-- Validated only when every row has a team: an invite into a language that had none is left as
-- it is, and the check still holds for every new row.
alter table "invite" add constraint "invite_join_team_check" check ("joinTeamId" is not null) not valid;
do $$
declare
  v_open integer;
begin
  select count(*) into v_open from "invite" where "joinTeamId" is null;
  if v_open = 0 then
    alter table "invite" validate constraint "invite_join_team_check";
  else
    raise notice '0123: % invites name no team and their language has none; the check is left not valid', v_open;
  end if;
end
$$;

-- A hand-over takes the language's open invites with it: they used to follow it by naming no
-- team. Otherwise as 0117.
create or replace function "move_team_lang"(p_lang text, p_team uuid) returns integer
language plpgsql security invoker as $$
declare
  v_from    uuid := team_of_lang(p_lang);
  v_running integer;
  v_moved   integer := 0;
  v_n       integer;
  t         text;
begin
  if p_lang = 'enUS' then
    raise exception 'enUS never moves: English is one team';
  end if;
  if not exists (select 1 from "team" where "id" = p_team) then
    raise exception 'no team %', p_team;
  end if;
  if exists (select 1 from "team_language" where "teamId" = p_team and "lang" = p_lang) then
    raise exception 'team % already holds %', p_team, p_lang;
  end if;
  if v_from is null then
    raise exception '% has no team to move from', p_lang;
  end if;

  -- A running job would commit its take under the old team after the move. Locking the
  -- language's open jobs keeps one from being claimed between this count and the commit.
  select count(*) filter (where "state" = 'running') into v_running
    from (select "state" from "regeneration_job"
           where "lang" = p_lang and "state" in ('pending', 'running')
             for update) j;
  if v_running > 0 then
    raise exception '% has % running regeneration job(s); move it once they finish', p_lang, v_running
      using errcode = '55006';
  end if;

  -- A new team voices the language exactly as before.
  perform copy_team_roster(v_from, p_team);

  foreach t in array array[
    'take', 'recording', 'take_ack', 'voice_clone', 'fish_reference', 'generation_setting_locale',
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_override', 'text_override', 'line_ignore', 'line_flag',
    'line_issue', 'report', 'regeneration_batch', 'regeneration_job', 'regeneration_pause', 'activity',
    'release_run'
  ] loop
    execute format('update %I set "teamId" = $1 where "teamId" = $2 and "lang" = $3', t)
      using p_team, v_from, p_lang;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;
  end loop;

  -- A sample's language is in its clone's name, 'voice@lang'.
  update "voice_sample" set "teamId" = p_team
   where "teamId" = v_from and right("clone", length(p_lang) + 1) = '@' || p_lang;
  get diagnostics v_n = row_count;
  v_moved := v_moved + v_n;

  update "line_issue_line" l set "teamId" = p_team
    from "line_issue" i
   where i."id" = l."issueId" and i."teamId" = p_team and i."lang" = p_lang and l."teamId" = v_from;
  get diagnostics v_n = row_count;
  v_moved := v_moved + v_n;

  update "invite" set "joinTeamId" = p_team
   where "joinTeamId" = v_from and "lang" = p_lang and "acceptedAt" is null and "revokedAt" is null;

  -- Moved by delete and insert: the app role may not update a grant.
  with "gone" as (
    delete from "team_member" where "teamId" = v_from and "lang" = p_lang
    returning "userId", "capability", "grantedAt", "grantedBy"
  )
  insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedAt", "grantedBy")
  select p_team, "userId", p_lang, "capability", "grantedAt", "grantedBy" from "gone"
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_moved := v_moved + v_n;

  delete from "team_language" where "teamId" = v_from and "lang" = p_lang;
  insert into "team_language" ("teamId", "lang", "packName") values (p_team, p_lang, 'plain');

  -- Both pm2 workers drop their team memo on this, delivered at commit.
  perform pg_notify('spoken_team_language', p_lang);
  return v_moved;
end
$$;

-- Only English is still given a team at boot: with none, the site could write nothing in it. A
-- previous release calls this for every language and now gets a team for English alone.
create or replace function "adopt_lang"(p_lang text) returns void
language plpgsql as $$
begin
  if p_lang = 'enUS' and team_of_lang(p_lang) is null then
    perform found_lang_team(p_lang);
  end if;
end
$$;
