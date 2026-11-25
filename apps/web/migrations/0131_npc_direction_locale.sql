-- An NPC's direction in one language, over its global one in "npc"."direction" (0126). A
-- direction is how a voice performs the line, so a team's own like its race directions
-- ("generation_setting_locale"."raceTags"): its language maintainers set it, not the site admin.
--
-- Additive: the previous release never reads this table and keeps using the global direction.

create table "npc_direction_locale" (
  "teamId"    uuid        not null default spoken_team() references "team" ("id"),
  "lang"      text        not null,
  "npcKind"   text        not null,
  "npcId"     integer     not null,
  -- Stored bracketed, like the global one.
  "direction" text        not null,
  "updatedAt" timestamptz not null default now(),
  "updatedBy" text        references "user" ("id") on delete set null,
  primary key ("teamId", "lang", "npcKind", "npcId"),
  foreign key ("npcKind", "npcId") references "npc" ("npcKind", "npcId") on delete cascade
);

alter table "npc_direction_locale" enable row level security;
alter table "npc_direction_locale" force row level security;
create policy "team_isolation" on "npc_direction_locale"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

-- A language's NPC directions are its team's, so they move with it.
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
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_override', 'text_override', 'npc_direction_locale', 'line_ignore', 'line_flag',
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

-- A second team of the language starts voicing its NPCs as the first one does.
create or replace function "copy_team_settings"(p_from uuid, p_to uuid, p_lang text) returns void
language plpgsql security invoker as $$
begin
  perform copy_team_roster(p_from, p_to);
  insert into "generation_setting_locale"
    ("teamId", "lang", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy")
  select p_to, "lang", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy"
    from "generation_setting_locale" where "teamId" = p_from and "lang" = p_lang
  on conflict do nothing;
  insert into "pronunciation_lexicon_locale" ("teamId", "lang", "entries", "updatedBy")
  select p_to, "lang", "entries", "updatedBy"
    from "pronunciation_lexicon_locale" where "teamId" = p_from and "lang" = p_lang
  on conflict do nothing;
  insert into "npc_direction_locale" ("teamId", "lang", "npcKind", "npcId", "direction", "updatedBy")
  select p_to, "lang", "npcKind", "npcId", "direction", "updatedBy"
    from "npc_direction_locale" where "teamId" = p_from and "lang" = p_lang
  on conflict do nothing;
end
$$;
