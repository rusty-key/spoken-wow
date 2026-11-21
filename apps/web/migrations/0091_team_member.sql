-- Additive: the audio grants are copied into team_member and stay in language_grant, which the
-- previous release still reads.

-- migrate.sh runs psql at warning level; the per-language progress below is a notice.
set local client_min_messages = notice;

-- Audio capabilities only; `edit` stays in language_grant. Not row-level secured: a viewer's
-- grants span teams, so it is read before any team is set.
create table "team_member" (
  "teamId"     uuid        not null references "team" ("id") on delete cascade,
  "userId"     text        not null references "user" ("id") on delete cascade,
  "lang"       text        not null,
  "capability" text        not null
    check ("capability" in ('regenerate', 'configure', 'ignore', 'admin', 'record')),
  "grantedAt"  timestamptz not null default now(),
  "grantedBy"  text        references "user" ("id") on delete set null,
  primary key ("teamId", "userId", "lang", "capability")
);

create index "team_member_user_idx" on "team_member" ("userId");

-- A grant is given or taken away, never edited; 0090's default privileges would allow update.
revoke all on "team_member" from "spoken_app";
grant select, insert, delete on "team_member" to "spoken_app";

-- A team with no languages. A taken slug raises unique_violation (23505): handing back the team
-- already named so would give its languages and members to whoever asked.
create function "new_team"(p_slug text, p_name text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into "team" ("slug", "name") values (p_slug, p_name)
  returning "id" into v_id;
  return v_id;
end
$$;

create function "free_team_slug"(p_base text) returns text
language plpgsql as $$
declare
  v_slug text := p_base;
  v_n    integer := 1;
begin
  while exists (select 1 from "team" where "slug" = v_slug) loop
    v_n := v_n + 1;
    v_slug := p_base || '-' || v_n;
  end loop;
  return v_slug;
end
$$;

-- A team without a roster would voice its languages with no voices; one that has a roster
-- keeps it.
create function "copy_team_roster"(p_from uuid, p_to uuid) returns void
language plpgsql security invoker as $$
begin
  if exists (select 1 from "voice" where "teamId" = p_to) then
    return;
  end if;
  insert into "voice" ("teamId", "name", "race", "gender")
  select p_to, "name", "race", "gender" from "voice" where "teamId" = p_from
  on conflict do nothing;
  insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice")
  select p_to, "race", "gender", "flavor", "voice" from "voice_assignment" where "teamId" = p_from
  on conflict do nothing;
  insert into "generation_setting" ("teamId", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy")
  select p_to, "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy"
    from "generation_setting" where "teamId" = p_from
  on conflict do nothing;
  insert into "queue_dismissal" ("teamId", "throughJobId", "dismissedBy")
  select p_to, "throughJobId", "dismissedBy" from "queue_dismissal" where "teamId" = p_from
  on conflict do nothing;
end
$$;

-- Security invoker, so the caller's row-level security applies; the app calls it as ALL_TEAMS.
-- A running job raises object_in_use (55006) for the app to answer 409; other refusals are P0001.
create function "move_team_lang"(p_lang text, p_team uuid) returns integer
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
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_ignore', 'line_flag', 'line_issue',
    'report', 'regeneration_batch', 'regeneration_job', 'regeneration_pause', 'activity'
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
  insert into "team_language" ("teamId", "lang", "privileged") values (p_team, p_lang, true);

  -- Both pm2 workers drop their team memo on this, delivered at commit.
  perform pg_notify('spoken_team_language', p_lang);
  return v_moved;
end
$$;

-- The app calls it acting as no team, where row-level security would hide English's roster from
-- copy_team_roster, so it acts as every team until it returns. Not with a SET clause on the
-- function: for a custom parameter that takes a superuser, and production's owner is not one.
create function "adopt_lang"(p_lang text) returns void
language plpgsql as $$
declare
  v_team   uuid;
  v_caller text := current_setting('spoken.team', true);
begin
  perform set_config('spoken.team', '*', true);
  if team_of_lang(p_lang) is null then
    v_team := new_team(free_team_slug(lower(p_lang)), p_lang);
    perform copy_team_roster((select "id" from "team" where "slug" = 'english'), v_team);
    insert into "team_language" ("teamId", "lang", "privileged")
    values (v_team, p_lang, true)
    on conflict do nothing;
    perform pg_notify('spoken_team_language', p_lang);
  end if;
  perform set_config('spoken.team', coalesce(v_caller, ''), true);
end
$$;

-- Every language but English moves off the english team to a team of its own.
do $$
declare
  v_langs text[];
  v_lang  text;
  v_team  uuid;
  v_rows  integer := 0;
  v_i     integer := 0;
begin
  select coalesce(array_agg(tl."lang" order by tl."lang"), '{}') into v_langs
    from "team_language" tl
    join "team" t on t."id" = tl."teamId" and t."slug" = 'english'
   where tl."lang" <> 'enUS' and tl."privileged";
  foreach v_lang in array v_langs loop
    v_i := v_i + 1;
    v_team := new_team(free_team_slug(lower(v_lang)), v_lang);
    v_rows := v_rows + move_team_lang(v_lang, v_team);
    insert into "team_member" ("teamId", "userId", "lang", "capability")
    select v_team, u."id", v_lang, 'admin' from "user" u where u."email" = 'x@rusty.one'
    on conflict do nothing;
    raise notice '% / % %', v_i, cardinality(v_langs), v_lang;
  end loop;
  raise notice '0091: % languages moved off the english team, % rows moved', cardinality(v_langs), v_rows;
end
$$;

-- After the moves, so each grant lands on its language's final team. A grant in a language with
-- no team has nowhere to go and is only counted.
do $$
declare
  v_stranded integer;
begin
  with "audio" as (
    select g."userId", g."lang", g."capability", g."grantedAt", g."grantedBy", tl."teamId"
      from "language_grant" g
      left join "team_language" tl on tl."lang" = g."lang" and tl."privileged"
     where g."capability" <> 'edit'
  ), "copied" as (
    insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedAt", "grantedBy")
    select "teamId", "userId", "lang", "capability", "grantedAt", "grantedBy" from "audio"
     where "teamId" is not null
    on conflict do nothing
  )
  select count(*) filter (where "teamId" is null) into v_stranded from "audio";
  raise notice '0091: % team_member rows, % audio grants in a language with no team, not copied',
    (select count(*) from "team_member"), v_stranded;
end
$$;
