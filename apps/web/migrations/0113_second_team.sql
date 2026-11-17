-- A language can have a second team beside its privileged one. Additive: the previous release
-- never writes a second team's rows.
--
-- One person works in one team per language. The trigger is deferred so move_team_lang (delete
-- and re-insert in one transaction) passes. The advisory lock per (user, language) serializes
-- concurrent grants into two teams: the second sees the first's committed row and raises 23P01.
--
-- "invite"."joinTeamId" null means the language's privileged team.
--
-- People already in two teams of one language are listed in a notice. The trigger checks new
-- grants only, so an operator must remove one side of each pair.

set local client_min_messages = notice;

create function "team_member_one_team"() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('team_member:' || new."userId" || ':' || new."lang"));
  if exists (
    select 1 from "team_member"
     where "userId" = new."userId" and "lang" = new."lang" and "teamId" <> new."teamId"
  ) then
    raise exception '% already works on % in another team', new."userId", new."lang"
      using errcode = '23P01';
  end if;
  return null;
end
$$;

create constraint trigger "team_member_one_team_per_lang"
  after insert on "team_member"
  deferrable initially deferred
  for each row execute function "team_member_one_team"();

alter table "invite" add column "joinTeamId" uuid references "team" ("id") on delete cascade;

-- A second team voices the language as the first does, and starts from its model and lexicon
-- entries. The lexicon's ElevenLabs dictionary belongs to the team that synced it, so the copy
-- leaves the dictionary and sync columns empty for the new team's own first sync.
create function "copy_team_settings"(p_from uuid, p_to uuid, p_lang text) returns void
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
end
$$;

do $$
declare
  v_pairs integer;
  v_list  text;
begin
  select count(*), string_agg(p."userId" || ' ' || p."lang" || ' in ' || p."teams", '; ')
    into v_pairs, v_list
    from (
      select "userId", "lang", string_agg(distinct "teamId"::text, ', ') as "teams"
        from "team_member" group by "userId", "lang" having count(distinct "teamId") > 1
    ) p;
  raise notice '% (userId, lang) pairs already span two teams%', v_pairs, coalesce(': ' || v_list, '');
end
$$;
